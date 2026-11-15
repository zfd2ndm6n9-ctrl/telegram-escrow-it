import {
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getDealEscrowKeypair,
  getMasterKeypair,
  getSolanaConnection,
} from "./client.js";
import { lamportsToSolString } from "./amounts.js";

export type TransferResult =
  | { ok: true; signature: string; lamports: bigint; sol: string }
  | { ok: false; error: string };

/**
 * Trasferisce tutto il saldo SOL dell'account deal verso `toAddress`.
 * Fee pagata dalla master (hot wallet), così il deposito può essere inviato per intero.
 */
export async function payoutDealSol(
  dealId: string,
  toAddress: string,
): Promise<TransferResult> {
  const master = await getMasterKeypair();
  if (!master) {
    return { ok: false, error: "SOLANA_PRIVATE_KEY non configurata" };
  }

  const escrow = await getDealEscrowKeypair(dealId);
  if (!escrow) {
    return { ok: false, error: "Impossibile derivare la keypair del deal" };
  }

  let dest: PublicKey;
  try {
    dest = new PublicKey(toAddress.trim());
  } catch {
    return { ok: false, error: "Indirizzo Solana di destinazione non valido" };
  }

  const connection = getSolanaConnection();
  const balance = await connection.getBalance(escrow.publicKey);
  if (balance <= 0n) {
    return {
      ok: false,
      error: "Saldo escrow a 0: niente da trasferire",
    };
  }

  const masterBal = await connection.getBalance(master.publicKey);
  // ~5000 lamports per signature tipica; teniamo margine
  if (masterBal < 20_000n) {
    return {
      ok: false,
      error:
        "Hot wallet senza SOL sufficienti per le fee di rete. Ricarica la master con poco SOL.",
    };
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrow.publicKey,
      toPubkey: dest,
      lamports: balance,
    }),
  );
  tx.feePayer = master.publicKey;

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [master, escrow],
      { commitment: "confirmed" },
    );
    return {
      ok: true,
      signature,
      lamports: balance,
      sol: lamportsToSolString(balance),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`payoutDealSol #${dealId} failed:`, err);
    return { ok: false, error: msg };
  }
}

export async function getEscrowBalanceLamports(
  escrowAddress: string,
): Promise<bigint> {
  const connection = getSolanaConnection();
  const pk = new PublicKey(escrowAddress);
  return connection.getBalance(pk);
}
