/**
 * Conversione EUR → SOL da fonti pubbliche (CoinGecko → Coinbase).
 * Usata dopo Accetto per fissare l'importo escrow on-chain senza chiedere SOL all'utente.
 */

import { solToLamports } from "../solana/amounts.js";

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

type CacheEntry = { eurPerSol: number; at: number };

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
    console.warn(`FX fetch failed ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** EUR per 1 SOL da CoinGecko. */
async function fromCoinGecko(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=eur",
  );
  if (!data || typeof data !== "object") return null;
  const solana = (data as { solana?: { eur?: unknown } }).solana;
  const eur = solana?.eur;
  if (typeof eur !== "number" || !Number.isFinite(eur) || eur <= 0) return null;
  return eur;
}

/** EUR per 1 SOL da Coinbase (spot). */
async function fromCoinbase(): Promise<number | null> {
  const data = await fetchJson(
    "https://api.coinbase.com/v2/prices/SOL-EUR/spot",
  );
  if (!data || typeof data !== "object") return null;
  const amount = (data as { data?: { amount?: unknown } }).data?.amount;
  if (typeof amount !== "string" && typeof amount !== "number") return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Tasso EUR per 1 SOL (cache breve). */
export async function getEurPerSol(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.eurPerSol;
  }
  const rate = (await fromCoinGecko()) ?? (await fromCoinbase());
  if (rate == null) return null;
  cache = { eurPerSol: rate, at: Date.now() };
  return rate;
}

/**
 * Converte un importo EUR (numero) in stringa SOL (fino a 9 decimali, senza zeri finali).
 */
export function eurToSolAmount(eur: number, eurPerSol: number): string | null {
  if (!Number.isFinite(eur) || eur <= 0) return null;
  if (!Number.isFinite(eurPerSol) || eurPerSol <= 0) return null;
  const sol = eur / eurPerSol;
  if (!Number.isFinite(sol) || sol <= 0) return null;
  // Evita dust inutile; minimo ~1e-9 SOL
  if (sol < 1e-9) return null;
  // Fissa a 9 decimali (lamports); strip zeri finali restando parseabile da solToLamports
  const fixed = sol.toFixed(9).replace(/\.?0+$/, "");
  if (fixed === "0" || !fixed) return null;
  // Guard: deve convertire in lamports senza ambiguità (no scientific notation / NaN)
  if (solToLamports(fixed) == null) return null;
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
 * Da `priceEur` display → importo SOL on-chain.
 * `null` se tasso non disponibile o input non valido.
 */
export async function convertPriceEurToSol(
  priceEur: string,
): Promise<string | null> {
  const eur = euroDisplayToNumber(priceEur);
  if (eur == null) return null;
  const rate = await getEurPerSol();
  if (rate == null) return null;
  return eurToSolAmount(eur, rate);
}
