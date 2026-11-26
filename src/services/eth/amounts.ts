import { getAddress, isAddress } from "ethers";

export const ETH_DECIMALS = 18;
export const WEI_PER_ETH = 10n ** 18n;

/** Parse importo ETH (stringa utente) → wei (bigint). `0` → null. Max 18 decimali. */
export function ethToWei(amount: string): bigint | null {
  const normalized = amount.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) return null;
  const [wholeRaw, fracRaw = ""] = normalized.split(".");
  const whole = BigInt(wholeRaw);
  const fracPadded = (fracRaw + "0".repeat(ETH_DECIMALS)).slice(0, ETH_DECIMALS);
  const frac = BigInt(fracPadded);
  const wei = whole * WEI_PER_ETH + frac;
  if (wei <= 0n) return null;
  return wei;
}

export function weiToEthString(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / WEI_PER_ETH;
  const frac = abs % WEI_PER_ETH;
  const fracStr = frac.toString().padStart(ETH_DECIMALS, "0").replace(/0+$/, "");
  const body = fracStr.length ? `${whole}.${fracStr}` : `${whole}`;
  return neg ? `-${body}` : body;
}

/** Indirizzo ETH mainnet valido (EIP-55 o lowercase). */
export function isValidEthAddress(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  try {
    return isAddress(raw);
  } catch {
    return false;
  }
}

/** Checksum EIP-55; null se invalido. */
export function checksumEthAddress(value: string): string | null {
  const raw = value.trim();
  if (!isValidEthAddress(raw)) return null;
  try {
    return getAddress(raw);
  } catch {
    return null;
  }
}

/**
 * Testo che *sembra* un tentativo di wallet ETH (non chat libera).
 * Usato in turno wallet: junk → delete+errore; «ciao» → passa.
 */
export function looksLikeEthAddressAttempt(value: string): boolean {
  const t = value.trim().replace(/\s+/g, "");
  // 0x + 40 hex, o 40 hex nudi
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return true;
  if (/^[0-9a-fA-F]{40}$/.test(t)) return true;
  return false;
}
