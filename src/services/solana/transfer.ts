import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Commitment,
  type TransactionInstruction,
} from "@solana/web3.js";
import { config } from "../../config.js";
import {
  getDealEscrowKeypair,
  getMasterKeypair,
  getSolanaConnection,
} from "./client.js";
import { lamportsToSolString } from "./amounts.js";
import { computeReleaseFeeSplit } from "./fees.js";

export type PayoutKind = "release" | "refund";

export type PayoutOptions = {
  kind: PayoutKind;
  /** Solo release: wallet collaboratore (2.5%). Se assente → 5% tutto a platform. */
  collaboratorWallet?: string;
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
      alreadyDone?: boolean;
    }
  | { ok: false; error: string; errorCode?: string };

const MAX_PAYOUT_ATTEMPTS = 3;
const COMMITMENT: Commitment = "confirmed";

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
 * - release: 95% seller + 5% fee (split 2.5/2.5 se collaboratore)
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
  const balance = await connection.getBalance(escrow.publicKey);

  // Idempotenza on-chain: escrow già vuoto → niente da fare (caller marca completed)
  if (balance <= 0n) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire (già pagato?)",
      errorCode: "empty_escrow",
    };
  }

  const masterBal = await connection.getBalance(master.publicKey);
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

  if (kind === "refund") {
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

    const split = computeReleaseFeeSplit(balance, Boolean(collabPk));
    sellerLamports = split.sellerLamports;
    platformFeeLamports = split.platformLamports;
    collaboratorFeeLamports = split.collaboratorLamports;
    feeWalletStr = feeDest.pubkey.toBase58();
    collabWalletStr = collabPk?.toBase58();

    instructions = [];
    if (split.sellerLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: dest,
          lamports: split.sellerLamports,
        }),
      );
    }
    if (split.platformLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: feeDest.pubkey,
          lamports: split.platformLamports,
        }),
      );
    }
    if (collabPk && split.collaboratorLamports > 0n) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: collabPk,
          lamports: split.collaboratorLamports,
        }),
      );
    }

    // Safety: somma quote = balance (seller tiene il resto degli arrotondamenti)
    const accounted =
      split.sellerLamports +
      split.platformLamports +
      split.collaboratorLamports;
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
      };
    } catch (err) {
      lastErr = err;
      // Solo messaggio classificato — mai dump che possa includere secret/env
      const classified = classifyPayoutError(err);
      console.error(
        `payoutDealSol #${dealId} attempt ${attempt}/${MAX_PAYOUT_ATTEMPTS} failed: ${classified.code} — ${classified.message}`,
      );
      if (!isRetryableBlockhashError(err) || attempt === MAX_PAYOUT_ATTEMPTS) {
        break;
      }
      await sleep(400 * attempt);
    }
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
  if (lower.includes("429") || lower.includes("too many requests") || lower.includes("rate")) {
    return {
      code: "rpc",
      message:
        "RPC Solana saturato. Riprova tra un minuto (meglio un endpoint dedicato).",
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
