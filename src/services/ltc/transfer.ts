import * as bitcoin from "bitcoinjs-lib";
import { config } from "../../config.js";
import {
  broadcastRawTx,
  getAddressBalanceSats,
  getAddressUtxos,
  getFeeRates,
  type LtcUtxo,
} from "./api.js";
import { satsToLtcString, isValidLtcAddress } from "./amounts.js";
import {
  getDealEscrowKeypair,
  getMasterKeypair,
} from "./client.js";
import {
  computeReleaseFeeSplit,
  isDustOutput,
  LTC_DUST_SATS,
} from "./fees.js";
import { keypairToAddress, type LtcKeypair } from "./keys.js";
import { litecoinMainnet } from "./network.js";

export type PayoutKind = "release" | "refund";

export type PayoutOptions = {
  kind: PayoutKind;
  /** Solo release: wallet collaboratore LTC (2.5%). Se SOL/assente → 5% platform. */
  collaboratorWallet?: string;
};

export type TransferResult =
  | {
      ok: true;
      signature: string;
      sats: bigint;
      ltc: string;
      kind: PayoutKind;
      sellerSats?: bigint;
      platformFeeSats?: bigint;
      collaboratorFeeSats?: bigint;
      feeWallet?: string;
      collaboratorWallet?: string;
      collaboratorFeeFoldedToPlatform?: boolean;
      networkFeeSats?: bigint;
      alreadyDone?: boolean;
    }
  | { ok: false; error: string; errorCode?: string };

/** Stima vbytes: P2WPKH in ~68, out ~31, overhead ~10.5. */
function estimateVbytes(inputCount: number, outputCount: number): number {
  return Math.ceil(10.5 + inputCount * 68 + outputCount * 31);
}

function resolveFeeAddress(master: LtcKeypair): string {
  const raw = config.ltcFeeAddress?.trim();
  if (raw && isValidLtcAddress(raw)) return raw.trim();
  return keypairToAddress(master);
}

function scriptForAddress(address: string): Buffer {
  return Buffer.from(
    bitcoin.address.toOutputScript(address, litecoinMainnet),
  );
}

async function ensureUtxoScripts(
  address: string,
  utxos: LtcUtxo[],
): Promise<LtcUtxo[]> {
  const script = scriptForAddress(address);
  const hex = Buffer.from(script).toString("hex");
  return utxos.map((u) => ({
    ...u,
    scriptPubKeyHex: u.scriptPubKeyHex ?? hex,
  }));
}

/**
 * Payout escrow LTC → destinazione.
 * - refund: intero saldo − fee rete → buyer
 * - release: 95% seller + 5% fee (2.5/2.5 se collab LTC), fee rete da inputs
 *
 * Fee di rete: dedotta dagli UTXO escrow (modello UTXO; niente master fee-payer).
 */
export async function payoutDealLtc(
  dealId: string,
  toAddress: string,
  options: PayoutOptions = { kind: "refund" },
): Promise<TransferResult> {
  const kind = options.kind ?? "refund";
  const master = getMasterKeypair();
  if (!master) {
    return {
      ok: false,
      error: "LTC_PRIVATE_KEY non configurata",
      errorCode: "no_master",
    };
  }

  const escrow = getDealEscrowKeypair(dealId);
  if (!escrow) {
    return {
      ok: false,
      error: "Impossibile derivare la keypair LTC del deal",
      errorCode: "no_escrow_key",
    };
  }

  const dest = toAddress.trim();
  if (!isValidLtcAddress(dest)) {
    return {
      ok: false,
      error: "Indirizzo Litecoin di destinazione non valido",
      errorCode: "bad_dest",
    };
  }

  const escrowAddress = keypairToAddress(escrow);
  let utxos: LtcUtxo[];
  try {
    utxos = await getAddressUtxos(escrowAddress);
    utxos = await ensureUtxoScripts(escrowAddress, utxos);
  } catch (err) {
    const classified = classifyPayoutError(err);
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code === "unknown" ? "rpc" : classified.code,
    };
  }

  const balance = utxos.reduce((acc, u) => acc + u.value, 0n);
  if (balance <= 0n || utxos.length === 0) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
      errorCode: "empty_escrow",
    };
  }

  const rates = await getFeeRates();
  const satPerVb = Math.max(1, rates.preferredSatPerVb);

  let sellerSats: bigint | undefined;
  let platformFeeSats: bigint | undefined;
  let collaboratorFeeSats: bigint | undefined;
  let feeWalletStr: string | undefined;
  let collabWalletStr: string | undefined;
  let collaboratorFeeFoldedToPlatform = false;
  let outputs: Array<{ address: string; value: bigint }>;

  // Prima stima fee con N output previsti, poi raffina se dust fold cambia N.
  const planOutputs = (
    spendable: bigint,
  ): {
    outputs: Array<{ address: string; value: bigint }>;
    sellerSats?: bigint;
    platformFeeSats?: bigint;
    collaboratorFeeSats?: bigint;
    feeWallet?: string;
    collaboratorWallet?: string;
    folded?: boolean;
  } => {
    if (kind === "refund") {
      return {
        outputs: [{ address: dest, value: spendable }],
      };
    }

    const feeAddr = resolveFeeAddress(master);
    let collabAddr: string | undefined;
    const collabRaw = options.collaboratorWallet?.trim();
    if (collabRaw && isValidLtcAddress(collabRaw)) {
      if (collabRaw !== feeAddr && collabRaw !== dest) {
        collabAddr = collabRaw;
      }
    }

    const split = computeReleaseFeeSplit(spendable, Boolean(collabAddr));
    let plat = split.platformSats;
    let collab = split.collaboratorSats;
    let seller = split.sellerSats;
    let folded = false;

    // Dust collab → piega su platform (come rent-exempt SOL)
    if (collabAddr && isDustOutput(collab)) {
      plat += collab;
      collab = 0n;
      collabAddr = undefined;
      folded = true;
    }
    // Dust platform → piega su seller (meglio pagare seller che bruciare)
    if (isDustOutput(plat)) {
      seller += plat;
      plat = 0n;
    }
    if (isDustOutput(seller) && seller > 0n) {
      // Impossibile: deal troppo piccolo dopo fee rete
      throw Object.assign(new Error("Importo LTC sotto dust dopo fee di rete"), {
        code: "dust",
      });
    }

    const outs: Array<{ address: string; value: bigint }> = [];
    if (seller > 0n) outs.push({ address: dest, value: seller });
    if (plat > 0n) outs.push({ address: feeAddr, value: plat });
    if (collabAddr && collab > 0n) {
      outs.push({ address: collabAddr, value: collab });
    }

    return {
      outputs: outs,
      sellerSats: seller,
      platformFeeSats: plat,
      collaboratorFeeSats: collab,
      feeWallet: feeAddr,
      collaboratorWallet: collabAddr,
      folded,
    };
  };

  // Itera: stima fee → spendable → plan outputs → ricalcola fee se N cambia
  let networkFee = BigInt(
    estimateVbytes(utxos.length, kind === "refund" ? 1 : 2) * satPerVb,
  );
  let planned = planOutputs(balance - networkFee);
  networkFee = BigInt(
    estimateVbytes(utxos.length, Math.max(1, planned.outputs.length)) *
      satPerVb,
  );
  // Buffer +10% anti underpay fee
  networkFee = (networkFee * 110n) / 100n;
  if (networkFee < 200n) networkFee = 200n;

  if (balance <= networkFee + LTC_DUST_SATS) {
    return {
      ok: false,
      error:
        "Saldo escrow insufficiente dopo fee di rete Litecoin. Serve un deposito maggiore.",
      errorCode: "funds",
    };
  }

  try {
    planned = planOutputs(balance - networkFee);
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      errorCode: code === "dust" ? "dust" : "fee_math",
    };
  }

  // Aggiusta dust rounding: somma output + fee deve = balance
  const outSum = planned.outputs.reduce((a, o) => a + o.value, 0n);
  const accounted = outSum + networkFee;
  if (accounted > balance) {
    const overflow = accounted - balance;
    // Togli overflow dal primo output (seller/refund)
    if (planned.outputs[0] && planned.outputs[0].value > overflow + LTC_DUST_SATS) {
      planned.outputs[0] = {
        ...planned.outputs[0],
        value: planned.outputs[0].value - overflow,
      };
      if (planned.sellerSats != null) {
        planned.sellerSats -= overflow;
      }
    } else {
      return {
        ok: false,
        error: "Fee di rete troppo alte rispetto al deposito. Riprova più tardi.",
        errorCode: "funds",
      };
    }
  } else if (accounted < balance) {
    // Dust remainder → primo output
    const rem = balance - accounted;
    if (planned.outputs[0]) {
      planned.outputs[0] = {
        ...planned.outputs[0],
        value: planned.outputs[0].value + rem,
      };
      if (planned.sellerSats != null) planned.sellerSats += rem;
    }
  }

  outputs = planned.outputs;
  sellerSats = planned.sellerSats;
  platformFeeSats = planned.platformFeeSats;
  collaboratorFeeSats = planned.collaboratorFeeSats;
  feeWalletStr = planned.feeWallet;
  collabWalletStr = planned.collaboratorWallet;
  collaboratorFeeFoldedToPlatform = planned.folded ?? false;

  if (outputs.length === 0) {
    return {
      ok: false,
      error: "Niente da trasferire dopo lo split fee",
      errorCode: "empty_split",
    };
  }

  try {
    const psbt = new bitcoin.Psbt({ network: litecoinMainnet });
    for (const u of utxos) {
      const script = Buffer.from(u.scriptPubKeyHex ?? "", "hex");
      if (script.length === 0) {
        return {
          ok: false,
          error: "UTXO senza scriptPubKey (API LTC). Riprova o cambia LTC_API_URL.",
          errorCode: "rpc",
        };
      }
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: {
          script,
          value: u.value,
        },
      });
    }
    for (const o of outputs) {
      psbt.addOutput({
        address: o.address,
        value: o.value,
      });
    }

    for (let i = 0; i < utxos.length; i++) {
      psbt.signInput(i, escrow);
    }
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();
    const rawHex = tx.toHex();
    const txid = await broadcastRawTx(rawHex);

    const paidSats =
      kind === "release" && sellerSats != null ? sellerSats : outSum;

    return {
      ok: true,
      signature: txid,
      sats: paidSats,
      ltc: satsToLtcString(paidSats),
      kind,
      sellerSats,
      platformFeeSats,
      collaboratorFeeSats,
      feeWallet: feeWalletStr,
      collaboratorWallet: collabWalletStr,
      collaboratorFeeFoldedToPlatform:
        collaboratorFeeFoldedToPlatform || undefined,
      networkFeeSats: networkFee,
    };
  } catch (err) {
    const classified = classifyPayoutError(err);
    console.error(
      `payoutDealLtc #${dealId} failed: ${classified.code} — ${classified.message}`,
    );
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code,
    };
  }
}

export async function getEscrowBalanceSats(
  escrowAddress: string,
): Promise<bigint> {
  return getAddressBalanceSats(escrowAddress);
}

/** Indirizzo destinazione fee piattaforma (master se FEE_WALLET_LTC assente). */
export function getPlatformFeeWalletAddress(): string | null {
  const master = getMasterKeypair();
  if (!master) return null;
  return resolveFeeAddress(master);
}

/**
 * Messaggio italiano corto — niente dump API.
 */
export function classifyPayoutError(err: unknown): {
  code: string;
  message: string;
} {
  const blob =
    err instanceof Error
      ? `${err.message}\n${err.cause ?? ""}`
      : String(err);
  const lower = blob.toLowerCase();

  if (
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate")
  ) {
    return {
      code: "rpc",
      message:
        "API Litecoin saturata. Imposta LTC_API_URL dedicato o riprova tra poco.",
    };
  }
  if (
    lower.includes("insufficient") ||
    lower.includes("not enough") ||
    lower.includes("funds")
  ) {
    return {
      code: "funds",
      message: "Fondi insufficienti sull'escrow LTC (fee di rete incluse).",
    };
  }
  if (lower.includes("dust")) {
    return {
      code: "dust",
      message:
        "Importo LTC troppo piccolo (dust). Usa un deposito maggiore e riprova.",
    };
  }
  if (lower.includes("ltc_private_key") || lower.includes("non configurata")) {
    return {
      code: "config",
      message: "Escrow LTC non configurato sul server. Avvisa il supporto.",
    };
  }
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("fetch")) {
    return {
      code: "rpc",
      message: "API Litecoin non raggiungibile. Riprova tra poco.",
    };
  }

  return {
    code: "unknown",
    message:
      "Payout Litecoin non riuscito. Riprova il rilascio oppure apri disputa.",
  };
}
