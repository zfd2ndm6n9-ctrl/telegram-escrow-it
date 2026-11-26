import * as bitcoin from "bitcoinjs-lib";
import { litecoinMainnet } from "./network.js";

export const LTC_DECIMALS = 8;
export const SATS_PER_LTC = 100_000_000n;

/** Parse importo LTC (stringa utente) → satoshi (bigint). `0` → null. */
export function ltcToSats(amount: string): bigint | null {
  const normalized = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) return null;
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  const whole = BigInt(wholeRaw);
  const fracPadded = (fracRaw + "0".repeat(LTC_DECIMALS)).slice(0, LTC_DECIMALS);
  const frac = BigInt(fracPadded);
  const sats = whole * SATS_PER_LTC + frac;
  if (sats <= 0n) return null;
  return sats;
}

export function satsToLtcString(sats: bigint): string {
  const neg = sats < 0n;
  const abs = neg ? -sats : sats;
  const whole = abs / SATS_PER_LTC;
  const frac = abs % SATS_PER_LTC;
  const fracStr = frac.toString().padStart(LTC_DECIMALS, "0").replace(/0+$/, "");
  const body = fracStr.length ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

/**
 * Indirizzo LTC mainnet valido: bech32 (`ltc1…`) o legacy (`L…` / `M…`).
 */
export function isValidLtcAddress(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  try {
    bitcoin.address.toOutputScript(raw, litecoinMainnet);
    return true;
  } catch {
    return false;
  }
}

/**
 * Testo che *sembra* un tentativo di wallet LTC (non chat libera).
 * Usato in turno wallet: junk → delete+errore; «ciao» → passa.
 */
export function looksLikeLtcAddressAttempt(value: string): boolean {
  const t = value.trim().replace(/\s+/g, "");
  if (/^ltc1[a-z0-9]{20,90}$/i.test(t)) return true;
  // Legacy P2PKH / P2SH
  if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(t)) return true;
  return false;
}
