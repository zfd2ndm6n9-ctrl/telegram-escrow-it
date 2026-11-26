/**
 * Conversione EUR → ETH da fonti pubbliche (CoinGecko → Coinbase).
 * Usata dopo Accetto per fissare l'importo escrow on-chain senza chiedere ETH all'utente.
 */

import { ethToWei } from "../eth/amounts.js";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

type CacheEntry = { eurPerEth: number; at: number };

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
    console.warn(`FX ETH fetch failed ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromCoinGecko(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur",
  );
  if (!data || typeof data !== "object") return null;
  const ethereum = (data as { ethereum?: { eur?: unknown } }).ethereum;
  const eur = ethereum?.eur;
  if (typeof eur !== "number" || !Number.isFinite(eur) || eur <= 0) return null;
  return eur;
}

async function fromCoinbase(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coinbase.com/v2/prices/ETH-EUR/spot",
  );
  if (!data || typeof data !== "object") return null;
  const amount = (data as { data?: { amount?: unknown } }).data?.amount;
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Tasso EUR per 1 ETH (cache breve). */
export async function getEurPerEth(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.eurPerEth;
  }
  const rate = (await fromCoinGecko()) ?? (await fromCoinbase());
  if (rate == null) return null;
  cache = { eurPerEth: rate, at: Date.now() };
  return rate;
}

/**
 * Converte un importo EUR in stringa ETH (fino a 8 decimali display; wei ok).
 */
export function eurToEthAmount(eur: number, eurPerEth: number): string | null {
  if (!Number.isFinite(eur) || eur <= 0) return null;
  if (!Number.isFinite(eurPerEth) || eurPerEth <= 0) return null;
  const eth = eur / eurPerEth;
  if (!Number.isFinite(eth) || eth <= 0) return null;
  if (eth < 1e-18) return null;
  // 8 decimali bastano per soft-launch; parse accetta fino a 18.
  const fixed = eth.toFixed(8).replace(/\.?0+$/, "");
  if (fixed === "0" || !fixed) return null;
  if (ethToWei(fixed) == null) return null;
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
 * Da `priceEur` display → importo ETH on-chain.
 * `null` se tasso non disponibile o input non valido.
 */
export async function convertPriceEurToEth(
  priceEur: string,
): Promise<string | null> {
  const eur = euroDisplayToNumber(priceEur);
  if (eur == null) return null;
  const rate = await getEurPerEth();
  if (rate == null) return null;
  return eurToEthAmount(eur, rate);
}
