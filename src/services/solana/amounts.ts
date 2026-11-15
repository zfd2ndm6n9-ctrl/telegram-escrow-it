import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const SOL_DECIMALS = 9;

/** Parse importo SOL (stringa utente) → lamports (bigint). */
export function solToLamports(amount: string): bigint | null {
  const normalized = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) return null;
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  const whole = BigInt(wholeRaw);
  const fracPadded = (fracRaw + "0".repeat(SOL_DECIMALS)).slice(0, SOL_DECIMALS);
  const frac = BigInt(fracPadded);
  return whole * BigInt(LAMPORTS_PER_SOL) + frac;
}

export function lamportsToSolString(lamports: bigint): string {
  const neg = lamports < 0n;
  const abs = neg ? -lamports : lamports;
  const whole = abs / BigInt(LAMPORTS_PER_SOL);
  const frac = abs % BigInt(LAMPORTS_PER_SOL);
  const fracStr = frac.toString().padStart(SOL_DECIMALS, "0").replace(/0+$/, "");
  const body = fracStr.length ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

export function isValidSolAddress(value: string): boolean {
  try {
    const pk = new PublicKey(value.trim());
    return PublicKey.isOnCurve(pk.toBytes());
  } catch {
    return false;
  }
}
