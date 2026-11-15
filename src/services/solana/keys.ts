import { createHmac } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Carica la chiave master da env.
 * Accetta base58 (64 byte secret) oppure JSON array di numeri (64 elementi).
 */
export async function loadMasterKeypair(
  raw: string,
): Promise<Keypair> {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("SOLANA_PRIVATE_KEY vuota");
  }

  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(arr) || arr.length < 32) {
      throw new Error(
        "SOLANA_PRIVATE_KEY JSON non valida: serve un array di 64 (o 32) numeri",
      );
    }
    const bytes = Uint8Array.from(arr.map((n) => Number(n)));
    if (bytes.length === 32) {
      return Keypair.fromSeed(bytes);
    }
    if (bytes.length === 64) {
      return Keypair.fromSecretKey(bytes);
    }
    throw new Error(
      `SOLANA_PRIVATE_KEY JSON: lunghezza ${bytes.length}, attesi 32 o 64 byte`,
    );
  }

  const decoded = bs58.decode(trimmed);
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }
  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }
  throw new Error(
    `SOLANA_PRIVATE_KEY base58: lunghezza ${decoded.length}, attesi 32 o 64 byte`,
  );
}

/**
 * Indirizzo deposito univoco per deal: HMAC-SHA256(masterSecret, dealId) → seed 32 byte.
 * Nessuna chiave aggiuntiva persistita: si ricalcola a runtime dalla master.
 */
export async function deriveDealKeypair(
  master: Keypair,
  dealId: string,
): Promise<Keypair> {
  const seed = createHmac("sha256", Buffer.from(master.secretKey))
    .update(`telegram-escrow-it:deal:${dealId}`)
    .digest()
    .subarray(0, 32);
  return Keypair.fromSeed(seed);
}
