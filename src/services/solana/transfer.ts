import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Commitment,
} from "@solana/web3.js";
import {
  getDealEscrowKeypair,
  getMasterKeypair,
  getSolanaConnection,
} from "./client.js";
import { lamportsToSolString } from "./amounts.js";

export type TransferResult =
  | { ok: true; signature: string; lamports: bigint; sol: string }
  | { ok: false; error: string; errorCode?: string };

const MAX_PAYOUT_ATTEMPTS = 3;
const COMMITMENT: Commitment = "confirmed";

/**
 * Trasferisce tutto il saldo SOL dell'account deal verso `toAddress`.
 * Fee pagata dalla master (hot wallet), così il deposito può essere inviato per intero.
 *
 * Imposta sempre blockhash+lastValidBlockHeight a *confirmed* (stesso livello del
 * preflight): senza questo, su RPC pubblici/laggati compare spesso #7050008
 * (Blockhash not found) in simulazione.
 */
export async function payoutDealSol(
  dealId: string,
  toAddress: string,
): Promise<TransferResult> {
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
  if (balance <= 0n) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire",
      errorCode: "empty_escrow",
    };
  }

  const masterBal = await connection.getBalance(master.publicKey);
  // ~5000 lamports per signature tipica; teniamo margine
  if (masterBal < 20_000n) {
    return {
      ok: false,
      error:
        "Hot wallet senza SOL sufficienti per le fee di rete. Ricarica la master con poco SOL.",
      errorCode: "master_fee",
    };
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_PAYOUT_ATTEMPTS; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash(COMMITMENT);

      // web3.js v3: TransactionBlockhashCtor usa `blockhash` + lastValidBlockHeight
      const tx = new Transaction({
        feePayer: master.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: escrow.publicKey,
          toPubkey: dest,
          lamports: balance,
        }),
      );

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
      return {
        ok: true,
        signature,
        lamports: balance,
        sol: lamportsToSolString(balance),
      };
    } catch (err) {
      lastErr = err;
      console.error(
        `payoutDealSol #${dealId} attempt ${attempt}/${MAX_PAYOUT_ATTEMPTS} failed:`,
        err,
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
        "Rete Solana occupata (blockhash scaduto). Riprova /payseller tra qualche secondo.",
    };
  }
  if (
    lower.includes("block height exceeded") ||
    lower.includes("expired") && lower.includes("block")
  ) {
    return {
      code: "expired",
      message:
        "Transazione scaduta prima della conferma. Riprova /payseller.",
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
      "Payout on-chain non riuscito. Riprova /payseller oppure apri /dispute.",
  };
}
