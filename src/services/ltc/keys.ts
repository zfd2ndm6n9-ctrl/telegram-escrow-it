import { createHmac } from "node:crypto";
import { ECPairFactory, type ECPairInterface } from "ecpair";
import * as ecc from "tiny-secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { litecoinMainnet } from "./network.js";

const ECPair = ECPairFactory(ecc);

export type LtcKeypair = ECPairInterface;

/**
 * Carica la chiave master da env.
 * Accetta WIF Litecoin (`T…` / `6…`) oppure hex di 32 byte (64 char).
 */
export function loadMasterKeypair(raw: string): LtcKeypair {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("LTC_PRIVATE_KEY vuota");
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const priv = Buffer.from(trimmed, "hex");
    return ECPair.fromPrivateKey(priv, { network: litecoinMainnet });
  }

  try {
    return ECPair.fromWIF(trimmed, litecoinMainnet);
  } catch {
    throw new Error(
      "LTC_PRIVATE_KEY non valida: serve WIF Litecoin mainnet o hex 32 byte",
    );
  }
}

/**
 * Indirizzo deposito univoco per deal: HMAC-SHA256(masterSecret, dealId) → seed.
 * Prefisso distinto da SOL (`:ltc:deal:`) così le derive non collidono.
 */
export function deriveDealKeypair(
  master: LtcKeypair,
  dealId: string,
): LtcKeypair {
  if (!master.privateKey) {
    throw new Error("Master LTC senza privateKey");
  }
  const seed = createHmac("sha256", Buffer.from(master.privateKey))
    .update(`telegram-escrow-it:ltc:deal:${dealId}`)
    .digest()
    .subarray(0, 32);
  return ECPair.fromPrivateKey(Buffer.from(seed), { network: litecoinMainnet });
}

/** Bech32 P2WPKH (`ltc1q…`) — preferito per fee più basse. */
export function keypairToAddress(kp: LtcKeypair): string {
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(kp.publicKey),
    network: litecoinMainnet,
  });
  if (!payment.address) {
    throw new Error("Impossibile derivare indirizzo LTC da keypair");
  }
  return payment.address;
}
