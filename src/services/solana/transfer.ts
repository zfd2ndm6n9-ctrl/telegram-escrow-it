import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Commitment,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { config } from "../../config.js";
import {
  getDealEscrowKeypair,
  getMasterKeypair,
  getSolanaConnection,
} from "./client.js";
import { lamportsToSolString } from "./amounts.js";
import type { FeePayer } from "../../types.js";
import {
  cannotFundNewAccount,
  computeReleaseFeeSplit,
} from "./fees.js";

export type PayoutKind = "release" | "refund";

export type PayoutOptions = {
  kind: PayoutKind;
  /** Solo release: wallet collaboratore (2.5%). Se assente → 5% tutto a platform. */
  collaboratorWallet?: string;
  /**
   * Chi paga la fee 5% (default seller = split storico sul saldo).
   * `buyer` → fee = saldo × 500/10500 (deposito era prezzo+5%).
   */
  feePayer?: FeePayer;
};

export type TransferResult =
  | {
      ok: true;
      signature: string;
      lamports: bigint;
      sol: string;
      kind: PayoutKind;
      sellerLamports?: bigint;
      platformFeeLamports?: bigint;
      collaboratorFeeLamports?: bigint;
      feeWallet?: string;
      collaboratorWallet?: string;
      /** 2.5% collab piegato su platform (wallet collab sotto rent / non creato). */
      collaboratorFeeFoldedToPlatform?: boolean;
      alreadyDone?: boolean;
    }
  | { ok: false; error: string; errorCode?: string };

const MAX_PAYOUT_ATTEMPTS = 3;
const COMMITMENT: Commitment = "confirmed";
/** Fallback se getMinimumBalanceForRentExemption fallisce (system account 0 byte). */
const RENT_EXEMPT_FALLBACK = 890_880n;

async function resolveFeeWalletPubkey(
  masterPubkey: PublicKey,
): Promise<{ ok: true; pubkey: PublicKey } | { ok: false; error: string }> {
  const raw = config.feeWalletPubkey?.trim();
  if (!raw) {
    return { ok: true, pubkey: masterPubkey };
  }
  try {
    return { ok: true, pubkey: new PublicKey(raw) };
  } catch {
    return {
      ok: false,
      error: "FEE_WALLET_PUBKEY non valido",
    };
  }
}

/**
 * Payout escrow → destinazione.
 * - refund: intero saldo → buyer (nessuna fee servizio)
 * - release seller-fee: 95% seller + 5% fee (2.5/2.5 se collaboratore)
 * - release buyer-fee: seller = prezzo (≈100/105 del saldo) + fee 5% del prezzo
 *
 * Fee di rete pagata dalla master (hot wallet).
 * Una sola tx atomica (multi-ix) — fail-safe: o tutto o niente.
 */
export async function payoutDealSol(
  dealId: string,
  toAddress: string,
  options: PayoutOptions = { kind: "refund" },
): Promise<TransferResult> {
  const kind = options.kind ?? "refund";
  const master = await getMasterKeypair();
  if (!master) {
    return { ok: false, error: "SOLANA_PRIVATE_KEY non configurata", errorCode: "no_master" };
  }

  const escrow = await getDealEscrowKeypair(dealId);
  if (!escrow) {
    return {
      ok: false,
      error: "Impossibile derivare la keypair del deal",
      errorCode: "no_escrow_key",
    };
  }

  let dest: PublicKey;
  try {
    dest = new PublicKey(toAddress.trim());
  } catch {
    return {
      ok: false,
      error: "Indirizzo Solana di destinazione non valido",
      errorCode: "bad_dest",
    };
  }

  const connection = getSolanaConnection();
  let balance: bigint;
  try {
    balance = BigInt(await connection.getBalance(escrow.publicKey));
  } catch (err) {
    const classified = classifyPayoutError(err);
    console.error(
      `payoutDealSol #${dealId} getBalance(escrow) failed: ${classified.code} — ${classified.message}`,
    );
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code === "unknown" ? "rpc" : classified.code,
    };
  }

  // Idempotenza on-chain: escrow già vuoto → niente da fare (caller marca completed)
  if (balance <= 0n) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
      errorCode: "empty_escrow",
    };
  }

  let masterBal: bigint;
  try {
    masterBal = BigInt(await connection.getBalance(master.publicKey));
  } catch (err) {
    const classified = classifyPayoutError(err);
    console.error(
      `payoutDealSol #${dealId} getBalance(master) failed: ${classified.code} — ${classified.message}`,
    );
    return {
      ok: false,
      error: classified.message,
      errorCode: classified.code === "unknown" ? "rpc" : classified.code,
    };
  }
  // Multi-ix release può richiedere un po' più di fee di rete
  if (masterBal < 30_000n) {
    return {
      ok: false,
      error:
        "Hot wallet senza SOL sufficienti per le fee di rete. Ricarica la master con poco SOL.",
      errorCode: "master_fee",
    };
  }

  let instructions: TransactionInstruction[];
  let sellerLamports: bigint | undefined;
  let platformFeeLamports: bigint | undefined;
  let collaboratorFeeLamports: bigint | undefined;
  let feeWalletStr: string | undefined;
  let collabWalletStr: string | undefined;
  let collaboratorFeeFoldedToPlatform = false;

  if (kind === "refund") {
    const refundReceivable = await canReceiveSystemTransfer(
      connection,
      dest,
      balance,
    );
    if (!refundReceivable.ok) {
      return {
        ok: false,
        error:
          "Wallet buyer non ancora attivo on-chain e importo sotto rent-exempt. Usa un wallet già finanziato o un importo maggiore, poi riprova.",
        errorCode: "buyer_rent",
      };
    }
    instructions = [
      SystemProgram.transfer({
        fromPubkey: escrow.publicKey,
        toPubkey: dest,
        lamports: balance,
      }),
    ];
  } else {
    const feeDest = await resolveFeeWalletPubkey(master.publicKey);
    if (!feeDest.ok) {
      return { ok: false, error: feeDest.error, errorCode: "bad_fee_wallet" };
    }

    let collabPk: PublicKey | undefined;
    const collabRaw = options.collaboratorWallet?.trim();
    if (collabRaw) {
      try {
        collabPk = new PublicKey(collabRaw);
      } catch {
        return {
          ok: false,
          error: "Indirizzo SOL collaboratore non valido",
          errorCode: "bad_collab",
        };
      }
      // Evita ix duplicate se collab = fee wallet o = seller
      if (
        collabPk.equals(feeDest.pubkey) ||
        collabPk.equals(dest)
      ) {
        collabPk = undefined;
      }
    }

    const split = computeReleaseFeeSplit(
      balance,
      Boolean(collabPk),
      options.feePayer,
    );
    sellerLamports = split.sellerLamports;
    platformFeeLamports = split.platformLamports;
    collaboratorFeeLamports = split.collaboratorLamports;
    feeWalletStr = feeDest.pubkey.toBase58();
    collabWalletStr = collabPk?.toBase58();

    // Seller: se wallet nuovo e 95% < rent → fail chiaro (non pieghiamo il payout seller)
    const sellerReceivable = await canReceiveSystemTransfer(
      connection,
      dest,
      split.sellerLamports,
    );
    if (!sellerReceivable.ok) {
      return {
        ok: false,
        error:
          "Wallet seller non ancora attivo on-chain e importo sotto rent-exempt. Usa un wallet già finanziato o un importo maggiore, poi riprova.",
        errorCode: "seller_rent",
      };
    }

    if (collabPk && split.collaboratorLamports > 0n) {
      const collabReceivable = await canReceiveSystemTransfer(
        connection,
        collabPk,
        split.collaboratorLamports,
      );
      if (!collabReceivable.ok) {
        // Soft-fail collab: piega 2.5% su platform così seller+fee escono
        // (wallet collab mai finanziato / 2.5% < rent — soft-fail)
        console.warn(
          `payoutDealSol #${dealId}: collab ${collabPk.toBase58()} non finanziabile ` +
            `(${split.collaboratorLamports} < rent ${collabReceivable.rentExempt}); ` +
            `piego 2.5% su platform ${feeDest.pubkey.toBase58()}`,
        );
        platformFeeLamports = split.feeTotalLamports;
        collaboratorFeeLamports = 0n;
        collaboratorFeeFoldedToPlatform = true;
        collabPk = undefined;
      }
    }

    let platformDestPk = feeDest.pubkey;
    if (platformFeeLamports > 0n) {
      const feeReceivable = await canReceiveSystemTransfer(
        connection,
        platformDestPk,
        platformFeeLamports,
      );
      if (!feeReceivable.ok) {
        if (!platformDestPk.equals(master.publicKey)) {
          console.warn(
            `payoutDealSol #${dealId}: FEE_WALLET sotto rent; fee → master ${master.publicKey.toBase58()}`,
          );
          platformDestPk = master.publicKey;
          feeWalletStr = master.publicKey.toBase58();
        } else {
          return {
            ok: false,
            error:
              "Wallet fee non finanziabile (sotto rent-exempt). Avvisa admin.",
            errorCode: "fee_rent",
          };
        }
      }
    }

    instructions = [];
    if (sellerLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: dest,
          lamports: sellerLamports,
        }),
      );
    }
    if (platformFeeLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: platformDestPk,
          lamports: platformFeeLamports,
        }),
      );
    }
    if (collabPk && collaboratorFeeLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: collabPk,
          lamports: collaboratorFeeLamports,
        }),
      );
    }

    // Safety: somma quote = balance (seller tiene il resto degli arrotondamenti)
    const accounted =
      sellerLamports + platformFeeLamports + collaboratorFeeLamports;
    if (accounted !== balance) {
      return {
        ok: false,
        error: "Errore interno split fee (somma ≠ saldo). Avvisa admin.",
        errorCode: "fee_math",
      };
    }
    if (instructions.length === 0) {
      return {
        ok: false,
        error: "Niente da trasferire dopo lo split fee",
        errorCode: "empty_split",
      };
    }
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_PAYOUT_ATTEMPTS; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash(COMMITMENT);

      const tx = new Transaction({
        feePayer: master.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...instructions);

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [master, escrow],
        {
          commitment: COMMITMENT,
          preflightCommitment: COMMITMENT,
          maxRetries: 5n,
        },
      );

      const paidLamports =
        kind === "release" && sellerLamports != null
          ? sellerLamports
          : balance;

      return {
        ok: true,
        signature,
        lamports: paidLamports,
        sol: lamportsToSolString(paidLamports),
        kind,
        sellerLamports,
        platformFeeLamports,
        collaboratorFeeLamports,
        feeWallet: feeWalletStr,
        collaboratorWallet: collabWalletStr,
        collaboratorFeeFoldedToPlatform:
          collaboratorFeeFoldedToPlatform || undefined,
      };
    } catch (err) {
      lastErr = err;
      // Solo messaggio classificato — mai dump che possa includere secret/env
      const classified = classifyPayoutError(err);
      console.error(
        `payoutDealSol #${dealId} attempt ${attempt}/${MAX_PAYOUT_ATTEMPTS} failed: ${classified.code} — ${classified.message}`,
      );

      // Timeout/confirm race: la tx può essere già landata → escrow a 0.
      // Senza questo, retry con ix stale → "funds" e deal stuck pending.
      try {
        const balNow = BigInt(await connection.getBalance(escrow.publicKey));
        if (balNow <= 0n) {
          return {
            ok: false,
            error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
            errorCode: "empty_escrow",
          };
        }
      } catch (balErr) {
        console.warn(
          `payoutDealSol #${dealId} post-fail getBalance:`,
          balErr instanceof Error ? balErr.message : balErr,
        );
      }

      if (!isRetryableBlockhashError(err) || attempt === MAX_PAYOUT_ATTEMPTS) {
        break;
      }
      await sleep(400 * attempt);
    }
  }

  // Ultimo check: confirm timeout finale ma escrow già svuotato.
  try {
    const balFinal = BigInt(await connection.getBalance(escrow.publicKey));
    if (balFinal <= 0n) {
      return {
        ok: false,
        error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
        errorCode: "empty_escrow",
      };
    }
  } catch {
    // soft — fall through to classified error
  }

  const classified = classifyPayoutError(lastErr);
  return {
    ok: false,
    error: classified.message,
    errorCode: classified.code,
  };
}

export async function getEscrowBalanceLamports(
  escrowAddress: string,
): Promise<bigint> {
  const connection = getSolanaConnection();
  const pk = new PublicKey(escrowAddress);
  return connection.getBalance(pk);
}

/** Pubkey destinazione fee piattaforma (master se FEE_WALLET_PUBKEY assente). */
export async function getPlatformFeeWalletPubkey(): Promise<string | null> {
  const master = await getMasterKeypair();
  if (!master) return null;
  const resolved = await resolveFeeWalletPubkey(master.publicKey);
  if (!resolved.ok) return master.publicKey.toBase58();
  return resolved.pubkey.toBase58();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SystemProgram.transfer crea l'account destinazione solo se lamports ≥ rent-exempt.
 * Account già esistenti accettano anche dust.
 */
async function canReceiveSystemTransfer(
  connection: Connection,
  pubkey: PublicKey,
  lamports: bigint,
): Promise<{ ok: true } | { ok: false; rentExempt: bigint }> {
  if (lamports <= 0n) return { ok: true };
  let rentExempt = RENT_EXEMPT_FALLBACK;
  try {
    rentExempt = BigInt(
      await connection.getMinimumBalanceForRentExemption(0),
    );
  } catch (err) {
    console.warn(
      `getMinimumBalanceForRentExemption failed; using fallback ${RENT_EXEMPT_FALLBACK}:`,
      err instanceof Error ? err.message : err,
    );
  }
  let exists = false;
  try {
    const info = await connection.getAccountInfo(pubkey, COMMITMENT);
    exists = info != null;
  } catch (err) {
    console.warn(
      `getAccountInfo(${pubkey.toBase58()}) failed; assuming missing:`,
      err instanceof Error ? err.message : err,
    );
  }
  if (cannotFundNewAccount(exists, lamports, rentExempt)) {
    return { ok: false, rentExempt };
  }
  return { ok: true };
}

function errorBlob(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const ctx = (cur as { context?: { __code?: number | string } }).context;
      if (ctx?.__code != null) parts.push(String(ctx.__code));
      cur = cur.cause;
      continue;
    }
    parts.push(String(cur));
    break;
  }
  return parts.join("\n");
}

function isRetryableBlockhashError(err: unknown): boolean {
  const blob = errorBlob(err).toLowerCase();
  return (
    blob.includes("7050008") ||
    blob.includes("blockhash not found") ||
    blob.includes("blockhashnotfound") ||
    blob.includes("block height exceeded") ||
    blob.includes("blockhash_not_found")
  );
}

/**
 * Messaggio italiano corto per l’utente — niente dump SendTransactionError / getLogs / npx decode.
 */
export function classifyPayoutError(err: unknown): {
  code: string;
  message: string;
} {
  const blob = errorBlob(err);
  const lower = blob.toLowerCase();

  if (
    lower.includes("7050008") ||
    lower.includes("blockhash not found") ||
    lower.includes("blockhashnotfound")
  ) {
    return {
      code: "blockhash",
      message:
        "Rete Solana occupata (blockhash scaduto). Riprova tra qualche secondo.",
    };
  }
  if (
    lower.includes("block height exceeded") ||
    (lower.includes("expired") && lower.includes("block"))
  ) {
    return {
      code: "expired",
      message:
        "Transazione scaduta prima della conferma. Riprova il rilascio.",
    };
  }
  if (
    lower.includes("insufficientfundsforrent") ||
    lower.includes("insufficient funds for rent") ||
    lower.includes("insufficient lamports for rent") ||
    (lower.includes("rent") && lower.includes("exempt"))
  ) {
    return {
      code: "rent",
      message:
        "Trasferimento sotto rent-exempt verso wallet non ancora attivo. Per inviti: finanzia il wallet collab (~0.001 SOL) o riprova dopo il fix fold-to-platform.",
    };
  }
  if (
    lower.includes("insufficient funds") ||
    lower.includes("no record of a prior credit")
  ) {
    return {
      code: "funds",
      message:
        "Fondi insufficienti sull'escrow o sulla hot wallet (fee). Controlla i saldi e riprova.",
    };
  }
  if (lower.includes("7050002") || lower.includes("already processed")) {
    return {
      code: "already",
      message:
        "Transazione già processata. Controlla /blockchain o /stato prima di riprovare.",
    };
  }
  if (
    lower.includes("429") ||
    lower.includes("too many requests") ||
    lower.includes("rate") ||
    lower.includes("8190004") // web3 transport / WS rate-limit (pubblico RPC)
  ) {
    return {
      code: "rpc",
      message:
        "RPC Solana saturato (429/#8190004). Imposta SOLANA_RPC_URL dedicato (Helius/QuickNode) e riprova.",
    };
  }
  if (lower.includes("solana_private_key") || lower.includes("non configurata")) {
    return {
      code: "config",
      message: "Escrow SOL non configurato sul server. Avvisa il supporto.",
    };
  }

  return {
    code: "unknown",
    message:
      "Payout on-chain non riuscito. Riprova il rilascio oppure apri disputa.",
  };
}
