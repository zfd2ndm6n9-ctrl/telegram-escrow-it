/**
 * Fee di servizio sulla RELEASE (non sul refund) — stesso schema SOL.
 *
 * Totale trattenuto: 5% del saldo spendibile (dopo fee di rete).
 * - Senza invito / senza wallet LTC collab: 5% → FEE_WALLET_LTC
 * - Con collaboratore LTC: 2.5% → fee wallet, 2.5% → collaboratore
 * Seller riceve il 95%.
 */

export const PLATFORM_FEE_BPS = 500n; // 5.00%
export const COLLAB_FEE_BPS = 250n; // 2.50%
export const BPS_DENOMINATOR = 10_000n;

/** Dust tipico P2WPKH LTC (~546 sats legacy; usiamo soglia conservativa). */
export const LTC_DUST_SATS = 546n;

export type ReleaseFeeSplit = {
  totalSats: bigint;
  sellerSats: bigint;
  feeTotalSats: bigint;
  platformSats: bigint;
  collaboratorSats: bigint;
  hasCollaborator: boolean;
};

/**
 * Split intero in satoshi. Arrotonda per difetto sulle fee (seller tiene il resto).
 * Se l'importo è troppo piccolo, fee = 0 e seller prende tutto.
 */
export function computeReleaseFeeSplit(
  balanceSats: bigint,
  hasCollaborator: boolean,
): ReleaseFeeSplit {
  if (balanceSats <= 0n) {
    return {
      totalSats: 0n,
      sellerSats: 0n,
      feeTotalSats: 0n,
      platformSats: 0n,
      collaboratorSats: 0n,
      hasCollaborator: false,
    };
  }

  const feeTotalSats = (balanceSats * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const sellerSats = balanceSats - feeTotalSats;

  if (!hasCollaborator || feeTotalSats === 0n) {
    return {
      totalSats: balanceSats,
      sellerSats,
      feeTotalSats,
      platformSats: feeTotalSats,
      collaboratorSats: 0n,
      hasCollaborator: false,
    };
  }

  const collaboratorSats = (balanceSats * COLLAB_FEE_BPS) / BPS_DENOMINATOR;
  const platformSats = feeTotalSats - collaboratorSats;

  return {
    totalSats: balanceSats,
    sellerSats,
    feeTotalSats,
    platformSats,
    collaboratorSats,
    hasCollaborator: collaboratorSats > 0n,
  };
}

export function feeBpsLabel(): string {
  return "5%";
}

/** Output sotto dust → non creare (piegare su altro output). */
export function isDustOutput(sats: bigint): boolean {
  return sats > 0n && sats < LTC_DUST_SATS;
}
