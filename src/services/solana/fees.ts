/**
 * Fee di servizio sulla RELEASE (non sul refund).
 *
 * Totale trattenuto: 5% del *prezzo commerciale*.
 * - feePayer `seller` (default): deposito = prezzo; seller 95%, fee 5% del saldo.
 * - feePayer `buyer`: deposito = prezzo + 5%; seller = prezzo (100%), fee 5% del prezzo
 *   (= saldo × 500/10500).
 * - Con collaboratore: 2.5% → fee wallet, 2.5% → collaboratore (sul prezzo).
 */

import type { FeePayer } from "../../types.js";

export const PLATFORM_FEE_BPS = 500n; // 5.00%
export const COLLAB_FEE_BPS = 250n; // 2.50%
export const BPS_DENOMINATOR = 10_000n;
/** Denominatore split quando il buyer gross-up deposita prezzo+5%. */
export const BUYER_GROSS_BPS = BPS_DENOMINATOR + PLATFORM_FEE_BPS; // 10_500

export type ReleaseFeeSplit = {
  totalLamports: bigint;
  sellerLamports: bigint;
  /** Totale fee piattaforma (5% del prezzo commerciale) */
  feeTotalLamports: bigint;
  /** Quota master / FEE_WALLET */
  platformLamports: bigint;
  /** Quota collaboratore (0 se assente) */
  collaboratorLamports: bigint;
  hasCollaborator: boolean;
  feePayer: FeePayer;
};

/** Legacy senza campo → seller (comportamento storico). */
export function effectiveFeePayer(feePayer?: FeePayer | null): FeePayer {
  return feePayer === "buyer" ? "buyer" : "seller";
}

/**
 * Deposito on-chain da lockare all'Accetto.
 * Seller paga fee → deposito = prezzo. Buyer paga → deposito = prezzo + 5%.
 */
export function depositLamportsForFeePayer(
  commercialLamports: bigint,
  feePayer?: FeePayer | null,
): bigint {
  if (commercialLamports <= 0n) return 0n;
  if (effectiveFeePayer(feePayer) !== "buyer") return commercialLamports;
  const fee =
    (commercialLamports * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  return commercialLamports + fee;
}

/**
 * Split intero in lamports. Arrotonda per difetto sulle fee (seller tiene il resto).
 * Se l'importo è troppo piccolo, fee = 0 e seller prende tutto.
 */
export function computeReleaseFeeSplit(
  balanceLamports: bigint,
  hasCollaborator: boolean,
  feePayer?: FeePayer | null,
): ReleaseFeeSplit {
  const payer = effectiveFeePayer(feePayer);

  if (balanceLamports <= 0n) {
    return {
      totalLamports: 0n,
      sellerLamports: 0n,
      feeTotalLamports: 0n,
      platformLamports: 0n,
      collaboratorLamports: 0n,
      hasCollaborator: false,
      feePayer: payer,
    };
  }

  let feeTotalLamports: bigint;
  let sellerLamports: bigint;

  if (payer === "buyer") {
    // Deposito = commerciale + 5%. Fee = floor(bal * 500/10500); seller = resto (= commerciale).
    feeTotalLamports =
      (balanceLamports * PLATFORM_FEE_BPS) / BUYER_GROSS_BPS;
    sellerLamports = balanceLamports - feeTotalLamports;
  } else {
    feeTotalLamports =
      (balanceLamports * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    sellerLamports = balanceLamports - feeTotalLamports;
  }

  if (!hasCollaborator || feeTotalLamports === 0n) {
    return {
      totalLamports: balanceLamports,
      sellerLamports,
      feeTotalLamports,
      platformLamports: feeTotalLamports,
      collaboratorLamports: 0n,
      hasCollaborator: false,
      feePayer: payer,
    };
  }

  const collaboratorLamports =
    payer === "buyer"
      ? (balanceLamports * COLLAB_FEE_BPS) / BUYER_GROSS_BPS
      : (balanceLamports * COLLAB_FEE_BPS) / BPS_DENOMINATOR;
  // Platform prende il resto del 5% (evita arrotondamenti che sforano il totale)
  const platformLamports = feeTotalLamports - collaboratorLamports;

  return {
    totalLamports: balanceLamports,
    sellerLamports,
    feeTotalLamports,
    platformLamports,
    collaboratorLamports,
    hasCollaborator: collaboratorLamports > 0n,
    feePayer: payer,
  };
}

export function feeBpsLabel(): string {
  return "5%";
}

/**
 * SystemProgram.transfer verso un account inesistente richiede
 * lamports ≥ rent-exempt (altrimenti tutta la tx atomica fallisce).
 * Se l'account esiste già, anche dust è ok.
 */
export function cannotFundNewAccount(
  accountExists: boolean,
  lamports: bigint,
  rentExemptMinimum: bigint,
): boolean {
  if (lamports <= 0n) return false;
  if (accountExists) return false;
  return lamports < rentExemptMinimum;
}
