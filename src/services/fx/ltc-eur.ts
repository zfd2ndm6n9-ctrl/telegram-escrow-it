/**
 * Conversione EUR → LTC da fonti pubbliche (CoinGecko → Coinbase).
 * Usata dopo Accetto per fissare l'importo escrow on-chain senza chiedere LTC all'utente.
 */

import { ltcToSats } from "../ltc/amounts.js";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

type CacheEntry = { eurPerLtc: number; at: number };

let cache: CacheEntry | null = null;

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch (err) {
    console.warn(`FX LTC fetch failed ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromCoinGecko(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=eur",
  );
  if (!data || typeof data !== "object") return null;
  const litecoin = (data as { litecoin?: { eur?: unknown } }).litecoin;
  const eur = litecoin?.eur;
  if (typeof eur !== "number" || !Number.isFinite(eur) || eur <= 0) return null;
  return eur;
}

async function fromCoinbase(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coinbase.com/v2/prices/LTC-EUR/spot",
  );
  if (!data || typeof data !== "object") return null;
  const amount = (data as { data?: { amount?: unknown } }).data?.amount;
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Tasso EUR per 1 LTC (cache breve). */
export async function getEurPerLtc(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.eurPerLtc;
  }
  const rate = (await fromCoinGecko()) ?? (await fromCoinbase());
  if (rate == null) return null;
  cache = { eurPerLtc: rate, at: Date.now() };
  return rate;
}

/**
 * Converte un importo EUR in stringa LTC (fino a 8 decimali).
 */
export function eurToLtcAmount(eur: number, eurPerLtc: number): string | null {
  if (!Number.isFinite(eur) || eur <= 0) return null;
  if (!Number.isFinite(eurPerLtc) || eurPerLtc <= 0) return null;
  const ltc = eur / eurPerLtc;
  if (!Number.isFinite(ltc) || ltc <= 0) return null;
  if (ltc < 1e-8) return null;
  const fixed = ltc.toFixed(8).replace(/\.?0+$/, "");
  if (fixed === "0" || !fixed) return null;
  if (ltcToSats(fixed) == null) return null;
  return fixed;
}

/** EUR display (`12,50` / `5`) → numero. */
export function euroDisplayToNumber(priceEur: string): number | null {
  const s = priceEur.trim().replace(/\s/g, "");
  if (!s) return null;
  let normalized: string;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    normalized = s.replace(",", ".");
  } else {
    normalized = s;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Da `priceEur` display → importo LTC on-chain.
 * `null` se tasso non disponibile o input non valido.
 */
export async function convertPriceEurToLtc(
  priceEur: string,
): Promise<string | null> {
  const eur = euroDisplayToNumber(priceEur);
  if (eur == null) return null;
  const rate = await getEurPerLtc();
  if (rate == null) return null;
  return eurToLtcAmount(eur, rate);
}
