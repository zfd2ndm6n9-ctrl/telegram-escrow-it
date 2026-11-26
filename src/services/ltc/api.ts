/**
 * Client HTTP per saldo / UTXO / broadcast Litecoin.
 *
 * Default: litecoinspace.org (API stile mempool.space).
 * Override: `LTC_API_URL` (base senza trailing slash).
 * Opzionale: `LTC_API_TOKEN` (query `token=` — utile su BlockCypher).
 */

import { config } from "../../config.js";

const FETCH_TIMEOUT_MS = 15_000;

export type LtcUtxo = {
  txid: string;
  vout: number;
  value: bigint;
  /** hex scriptPubKey se disponibile (necessario per witness UTXO). */
  scriptPubKeyHex?: string;
};

export type LtcFeeRates = {
  /** sat/vB raccomandato (economia). */
  economySatPerVb: number;
  /** sat/vB half-hour / preferito. */
  preferredSatPerVb: number;
};

function apiBase(): string {
  return (
    config.ltcApiUrl?.replace(/\/+$/, "") ||
    "https://litecoinspace.org/api"
  );
}

function withToken(url: string): string {
  const token = config.ltcApiToken?.trim();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(withToken(url), {
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LTC API ${res.status}: ${body.slice(0, 200)}`);
    }
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(withToken(url), {
      ...init,
      signal: ctrl.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`LTC API ${res.status}: ${body.slice(0, 200)}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function isBlockCypherBase(base: string): boolean {
  return /blockcypher\.com/i.test(base);
}

/**
 * Saldo confermato in satoshi (chain_stats / final_balance).
 */
export async function getAddressBalanceSats(address: string): Promise<bigint> {
  const base = apiBase();
  if (isBlockCypherBase(base)) {
    const data = (await fetchJson(
      `${base}/addrs/${encodeURIComponent(address)}/balance`,
    )) as { balance?: number; final_balance?: number } | null;
    const bal = data?.balance ?? data?.final_balance ?? 0;
    return BigInt(Math.max(0, Math.floor(Number(bal))));
  }

  const data = (await fetchJson(
    `${base}/address/${encodeURIComponent(address)}`,
  )) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  } | null;
  const chain = data?.chain_stats;
  const funded = BigInt(chain?.funded_txo_sum ?? 0);
  const spent = BigInt(chain?.spent_txo_sum ?? 0);
  const bal = funded - spent;
  return bal > 0n ? bal : 0n;
}

/**
 * UTXO spendibili (confermati).
 * Lo scriptPubKey può essere omesso: il caller lo ricostruisce dall'indirizzo escrow P2WPKH.
 */
export async function getAddressUtxos(address: string): Promise<LtcUtxo[]> {
  const base = apiBase();

  if (isBlockCypherBase(base)) {
    const data = (await fetchJson(
      `${base}/addrs/${encodeURIComponent(address)}?unspentOnly=true&includeScript=true`,
    )) as {
      txrefs?: Array<{
        tx_hash: string;
        tx_output_n: number;
        value: number;
        script?: string;
        confirmations?: number;
      }>;
    } | null;
    const refs = data?.txrefs ?? [];
    return refs
      .filter((r) => (r.confirmations ?? 1) >= 1)
      .map((r) => ({
        txid: r.tx_hash,
        vout: r.tx_output_n,
        value: BigInt(r.value),
        scriptPubKeyHex: r.script,
      }));
  }

  const data = (await fetchJson(
    `${base}/address/${encodeURIComponent(address)}/utxo`,
  )) as Array<{
    txid: string;
    vout: number;
    value: number;
    status?: { confirmed?: boolean };
  }> | null;

  if (!Array.isArray(data)) return [];
  return data
    .filter((u) => u.status?.confirmed !== false)
    .map((u) => ({
      txid: u.txid,
      vout: u.vout,
      value: BigInt(u.value),
    }));
}

/** Fee rates sat/vB. Fallback conservativo se API down. */
export async function getFeeRates(): Promise<LtcFeeRates> {
  const fallback: LtcFeeRates = {
    economySatPerVb: 2,
    preferredSatPerVb: 5,
  };
  const base = apiBase();
  try {
    if (isBlockCypherBase(base)) {
      const data = (await fetchJson(base)) as {
        medium_fee_per_kb?: number;
        low_fee_per_kb?: number;
      } | null;
      const mid = Number(data?.medium_fee_per_kb ?? 0);
      const low = Number(data?.low_fee_per_kb ?? 0);
      if (mid > 0) {
        return {
          economySatPerVb: Math.max(1, Math.ceil(low / 1000) || 1),
          preferredSatPerVb: Math.max(1, Math.ceil(mid / 1000)),
        };
      }
      return fallback;
    }
    const data = (await fetchJson(`${base}/v1/fees/recommended`)) as {
      hourFee?: number;
      halfHourFee?: number;
      economyFee?: number;
      fastestFee?: number;
    } | null;
    const preferred = Number(
      data?.halfHourFee ?? data?.hourFee ?? data?.fastestFee ?? 0,
    );
    const economy = Number(data?.economyFee ?? data?.hourFee ?? preferred);
    if (preferred > 0) {
      return {
        economySatPerVb: Math.max(1, economy || preferred),
        preferredSatPerVb: Math.max(1, preferred),
      };
    }
  } catch (err) {
    console.warn(
      "LTC fee rates fetch failed; using fallback:",
      err instanceof Error ? err.message : err,
    );
  }
  return fallback;
}

/** Broadcast raw tx hex → txid. */
export async function broadcastRawTx(rawHex: string): Promise<string> {
  const base = apiBase();
  if (isBlockCypherBase(base)) {
    const data = (await fetchJson(`${base}/txs/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx: rawHex }),
    })) as { tx?: { hash?: string }; hash?: string } | null;
    const hash = data?.tx?.hash ?? data?.hash;
    if (!hash || typeof hash !== "string") {
      throw new Error("Broadcast BlockCypher: risposta senza hash");
    }
    return hash;
  }

  const txid = await fetchText(`${base}/tx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: rawHex,
  });
  const trimmed = txid.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      `Broadcast LTC: risposta inattesa (${trimmed.slice(0, 80)})`,
    );
  }
  return trimmed;
}
