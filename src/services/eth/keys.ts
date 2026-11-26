import { createHmac } from "node:crypto";
import { SigningKey, Wallet, computeAddress, hexlify } from "ethers";

/**
 * Carica la chiave master da env.
 * Accetta hex 32 byte con o senza prefisso `0x`.
 */
export function loadMasterWallet(raw: string): Wallet {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("ETH_PRIVATE_KEY vuota");
  }

  let hex = trimmed;
  if (hex.startsWith("0x") || hex.startsWith("0X")) {
    hex = hex.slice(2);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ETH_PRIVATE_KEY non valida: serve hex 32 byte (64 char, opz. 0x)",
    );
  }

  try {
    return new Wallet(`0x${hex.toLowerCase()}`);
  } catch {
    throw new Error("ETH_PRIVATE_KEY non valida: impossibile creare Wallet");
  }
}

/**
 * Indirizzo deposito univoco per deal: HMAC-SHA256(masterSecret, dealId) → seed.
 * Prefisso distinto (`:eth:deal:`) così le derive non collidono con SOL/LTC.
 */
export function deriveDealWallet(master: Wallet, dealId: string): Wallet {
  const masterHex = master.privateKey.replace(/^0x/i, "");
  const seed = createHmac("sha256", Buffer.from(masterHex, "hex"))
    .update(`telegram-escrow-it:eth:deal:${dealId}`)
    .digest()
    .subarray(0, 32);
  const priv = hexlify(seed);
  return new Wallet(priv);
}

export function walletToAddress(wallet: Wallet): string {
  return wallet.address;
}

/** Address da private key hex (smoke / keygen). */
export function addressFromPrivateKeyHex(hex32: string): string {
  const key = hex32.startsWith("0x") ? hex32 : `0x${hex32}`;
  const signing = new SigningKey(key);
  return computeAddress(signing.publicKey);
}
