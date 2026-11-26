import type { Wallet } from "ethers";
import { config } from "../../config.js";
import {
  checksumEthAddress,
  isValidEthAddress,
  weiToEthString,
} from "./amounts.js";
import {
  getDealEscrowWallet,
  getMasterWallet,
} from "./client.js";
import {
  computeReleaseFeeSplit,
  isDustOutput,
  ETH_DUST_WEI,
} from "./fees.js";
import { walletToAddress } from "./keys.js";
import {
  estimateNativeTransferGasReserve,
  getAddressBalanceWei,
  getEthProvider,
  waitTx,
} from "./rpc.js";

export type PayoutKind = "release" | "refund";

export type PayoutOptions = {
  kind: PayoutKind;
  /** Solo release: wallet collaboratore ETH (2.5%). Se SOL/LTC/assente → 5% platform. */
  collaboratorWallet?: string;
};

export type TransferResult =
  | {
      ok: true;
      signature: string;
      wei: bigint;
      eth: string;
      kind: PayoutKind;
      sellerWei?: bigint;
      platformFeeWei?: bigint;
      collaboratorFeeWei?: bigint;
      feeWallet?: string;
      collaboratorWallet?: string;
      collaboratorFeeFoldedToPlatform?: boolean;
      networkFeeWei?: bigint;
      feeTxHashes?: string[];
      alreadyDone?: boolean;
    }
  | { ok: false; error: string; errorCode?: string };

function resolveFeeAddress(master: Wallet): string {
  const raw = config.ethFeeAddress?.trim();
  if (raw && isValidEthAddress(raw)) {
    return checksumEthAddress(raw) ?? raw.trim();
  }
  return walletToAddress(master);
}

/**
 * Payout escrow ETH → destinazione.
 * - refund: intero saldo − gas → buyer (1 tx)
 * - release: 95% seller + 5% fee (2.5/2.5 se collab ETH) in tx sequenziali
 *
 * Gas: pagato dall'escrow (dedotto dal saldo prima dello split). Niente fee-payer esterno.
 * Native ETH non supporta multi-output atomico → seller prima, poi fee/collab.
 */
export async function payoutDealEth(
  dealId: string,
  toAddress: string,
  options: PayoutOptions = { kind: "refund" },
): Promise<TransferResult> {
  const kind = options.kind ?? "refund";
  const master = getMasterWallet();
  if (!master) {
    return {
      ok: false,
      error: "ETH_PRIVATE_KEY non configurata",
      errorCode: "no_master",
    };
  }

  const escrow = getDealEscrowWallet(dealId);
  if (!escrow) {
    return {
      ok: false,
      error: "Impossibile derivare la keypair ETH del deal",
      errorCode: "no_escrow_key",
    };
  }

  const destCs = checksumEthAddress(toAddress);
  if (!destCs) {
    return {
      ok: false,
      error: "Indirizzo Ethereum di destinazione non valido",
      errorCode: "bad_dest",
    };
  }

  const escrowAddress = walletToAddress(escrow);
  let balance: bigint;
  try {
    balance = await getAddressBalanceWei(escrowAddress);
  } catch (err) {
    const classified = classifyPayoutError(err);
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code === "unknown" ? "rpc" : classified.code,
    };
  }

  if (balance <= 0n) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
      errorCode: "empty_escrow",
    };
  }

  // Quanti transfer nativi prevediamo?
  let plannedTransfers = 1; // refund o almeno seller
  let feeAddr: string | undefined;
  let collabAddr: string | undefined;
  let folded = false;

  if (kind === "release") {
    feeAddr = resolveFeeAddress(master);
    const collabRaw = options.collaboratorWallet?.trim();
    if (collabRaw && isValidEthAddress(collabRaw)) {
      const cs = checksumEthAddress(collabRaw);
      if (cs && cs !== feeAddr && cs !== destCs) {
        collabAddr = cs;
      }
    }
    plannedTransfers = collabAddr ? 3 : 2;
  }

  let gasReserve: bigint;
  let maxFeePerGas: bigint;
  try {
    const est = await estimateNativeTransferGasReserve(plannedTransfers);
    gasReserve = est.reserveWei;
    maxFeePerGas = est.maxFeePerGas;
  } catch (err) {
    const classified = classifyPayoutError(err);
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code === "unknown" ? "rpc" : classified.code,
    };
  }

  if (balance <= gasReserve + ETH_DUST_WEI) {
    return {
      ok: false,
      error:
        "Saldo escrow insufficiente dopo gas Ethereum. Serve un deposito maggiore.",
      errorCode: "funds",
    };
  }

  const spendable = balance - gasReserve;
  let sellerWei: bigint | undefined;
  let platformFeeWei: bigint | undefined;
  let collaboratorFeeWei: bigint | undefined;
  const transfers: Array<{ address: string; value: bigint; label: string }> = [];

  if (kind === "refund") {
    transfers.push({ address: destCs, value: spendable, label: "refund" });
  } else {
    const split = computeReleaseFeeSplit(spendable, Boolean(collabAddr));
    let plat = split.platformWei;
    let collab = split.collaboratorWei;
    let seller = split.sellerWei;

    if (collabAddr && isDustOutput(collab)) {
      plat += collab;
      collab = 0n;
      collabAddr = undefined;
      folded = true;
      // Ricalcola gas reserve per 2 invece di 3
      try {
        const est2 = await estimateNativeTransferGasReserve(2);
        const delta = gasReserve - est2.reserveWei;
        if (delta > 0n) {
          seller += delta;
          gasReserve = est2.reserveWei;
          maxFeePerGas = est2.maxFeePerGas;
        }
      } catch {
        // tieni stima precedente
      }
    }
    if (isDustOutput(plat)) {
      seller += plat;
      plat = 0n;
      feeAddr = undefined;
    }
    if (isDustOutput(seller) && seller > 0n) {
      return {
        ok: false,
        error: "Importo ETH sotto dust dopo gas. Usa un deposito maggiore.",
        errorCode: "dust",
      };
    }

    if (seller > 0n) {
      transfers.push({ address: destCs, value: seller, label: "seller" });
    }
    if (feeAddr && plat > 0n) {
      transfers.push({ address: feeAddr, value: plat, label: "platform" });
    }
    if (collabAddr && collab > 0n) {
      transfers.push({ address: collabAddr, value: collab, label: "collab" });
    }

    sellerWei = seller;
    platformFeeWei = plat;
    collaboratorFeeWei = collab;
  }

  if (transfers.length === 0) {
    return {
      ok: false,
      error: "Niente da trasferire dopo lo split fee",
      errorCode: "empty_split",
    };
  }

  const provider = getEthProvider();
  const signer = escrow.connect(provider);
  const feeTxHashes: string[] = [];
  let primaryHash: string | undefined;

  try {
    let nonce = await provider.getTransactionCount(escrowAddress, "pending");

    for (const t of transfers) {
      const txReq = {
        to: t.address,
        value: t.value,
        gasLimit: 21_000n,
        maxFeePerGas,
        maxPriorityFeePerGas:
          maxFeePerGas > 1_000_000_000n
            ? 1_000_000_000n
            : maxFeePerGas,
        nonce,
        chainId: 1,
        type: 2 as const,
      };
      const sent = await signer.sendTransaction(txReq);
      const hash = await waitTx(sent, 1);
      nonce += 1;

      if (t.label === "seller" || t.label === "refund") {
        primaryHash = hash;
      } else {
        feeTxHashes.push(hash);
      }
    }

    if (!primaryHash) {
      // Solo fee (edge): usa prima fee come signature
      primaryHash = feeTxHashes[0];
    }
    if (!primaryHash) {
      return {
        ok: false,
        error: "Nessuna tx ETH broadcast",
        errorCode: "unknown",
      };
    }

    const paidWei =
      kind === "release" && sellerWei != null
        ? sellerWei
        : transfers[0]?.value ?? 0n;

    return {
      ok: true,
      signature: primaryHash,
      wei: paidWei,
      eth: weiToEthString(paidWei),
      kind,
      sellerWei,
      platformFeeWei,
      collaboratorFeeWei,
      feeWallet: feeAddr,
      collaboratorWallet: collabAddr,
      collaboratorFeeFoldedToPlatform: folded || undefined,
      networkFeeWei: gasReserve,
      feeTxHashes: feeTxHashes.length ? feeTxHashes : undefined,
    };
  } catch (err) {
    const classified = classifyPayoutError(err);
    console.error(
      `payoutDealEth #${dealId} failed: ${classified.code} — ${classified.message}` +
        (primaryHash ? ` (primary=${primaryHash})` : ""),
    );
    // Se seller già pagato ma fee fallita: segnala successo parziale col primary
    if (primaryHash) {
      return {
        ok: true,
        signature: primaryHash,
        wei: sellerWei ?? transfers[0]?.value ?? 0n,
        eth: weiToEthString(sellerWei ?? transfers[0]?.value ?? 0n),
        kind,
        sellerWei,
        platformFeeWei,
        collaboratorFeeWei,
        feeWallet: feeAddr,
        collaboratorWallet: collabAddr,
        collaboratorFeeFoldedToPlatform: folded || undefined,
        networkFeeWei: gasReserve,
        feeTxHashes: feeTxHashes.length ? feeTxHashes : undefined,
      };
    }
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code,
    };
  }
}

export async function getEscrowBalanceWei(
  escrowAddress: string,
): Promise<bigint> {
  return getAddressBalanceWei(escrowAddress);
}

/** Indirizzo destinazione fee piattaforma (master se FEE_WALLET_ETH assente). */
export function getPlatformFeeWalletAddress(): string | null {
  const master = getMasterWallet();
  if (!master) return null;
  return resolveFeeAddress(master);
}

/**
 * Messaggio italiano corto — niente dump RPC.
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
        "RPC Ethereum saturato. Imposta ETH_RPC_URL dedicato o riprova tra poco.",
    };
  }
  if (
    lower.includes("insufficient funds") ||
    lower.includes("insufficient") ||
    lower.includes("not enough") ||
    lower.includes("funds")
  ) {
    return {
      code: "funds",
      message: "Fondi insufficienti sull'escrow ETH (gas incluso).",
    };
  }
  if (lower.includes("dust")) {
    return {
      code: "dust",
      message:
        "Importo ETH troppo piccolo (dust). Usa un deposito maggiore e riprova.",
    };
  }
  if (lower.includes("eth_private_key") || lower.includes("non configurata")) {
    return {
      code: "config",
      message: "Escrow ETH non configurato sul server. Avvisa il supporto.",
    };
  }
  if (
    lower.includes("timeout") ||
    lower.includes("abort") ||
    lower.includes("fetch") ||
    lower.includes("econnrefused") ||
    lower.includes("network")
  ) {
    return {
      code: "rpc",
      message: "RPC Ethereum non raggiungibile. Riprova tra poco.",
    };
  }
  if (lower.includes("nonce") || lower.includes("replacement")) {
    return {
      code: "rpc",
      message: "Nonce ETH in conflitto. Riprova il rilascio tra poco.",
    };
  }

  return {
    code: "unknown",
    message:
      "Payout Ethereum non riuscito. Riprova il rilascio oppure apri disputa.",
  };
}
