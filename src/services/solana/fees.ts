/**
 * Fee di servizio sulla RELEASE (non sul refund).
 *
 * Totale trattenuto: 5% del saldo escrow.
 * - Senza invito: 5% → wallet fee (master / FEE_WALLET_PUBKEY)
 * - Con collaboratore: 2.5% → fee wallet, 2.5% → collaboratore
 * Seller riceve il 95%.
 */

export const PLATFORM_FEE_BPS = 500n; // 5.00%
export const COLLAB_FEE_BPS = 250n; // 2.50%
export const BPS_DENOMINATOR = 10_000n;

export type ReleaseFeeSplit = {
  totalLamports: bigint;
  sellerLamports: bigint;
  /** Totale fee piattaforma (5%) */
  feeTotalLamports: bigint;
  /** Quota master / FEE_WALLET */
  platformLamports: bigint;
  /** Quota collaboratore (0 se assente) */
  collaboratorLamports: bigint;
  hasCollaborator: boolean;
};

/**
 * Split intero in lamports. Arrotonda per difetto sulle fee (seller tiene il resto).
 * Se l'importo è troppo piccolo, fee = 0 e seller prende tutto.
 */
export function computeReleaseFeeSplit(
  balanceLamports: bigint,
  hasCollaborator: boolean,
): ReleaseFeeSplit {
  if (balanceLamports <= 0n) {
    return {
      totalLamports: 0n,
      sellerLamports: 0n,
      feeTotalLamports: 0n,
      platformLamports: 0n,
      collaboratorLamports: 0n,
      hasCollaborator: false,
    };
  }

  const feeTotalLamports = (balanceLamports * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const sellerLamports = balanceLamports - feeTotalLamports;

  if (!hasCollaborator || feeTotalLamports === 0n) {
    return {
      totalLamports: balanceLamports,
      sellerLamports,
      feeTotalLamports,
      platformLamports: feeTotalLamports,
      collaboratorLamports: 0n,
      hasCollaborator: false,
    };
  }

  const collaboratorLamports =
    (balanceLamports * COLLAB_FEE_BPS) / BPS_DENOMINATOR;
  // Platform prende il resto del 5% (evita arrotondamenti che sforano il totale)
  const platformLamports = feeTotalLamports - collaboratorLamports;

  return {
    totalLamports: balanceLamports,
    sellerLamports,
    feeTotalLamports,
    platformLamports,
    collaboratorLamports,
    hasCollaborator: collaboratorLamports > 0n,
  };
}

export function feeBpsLabel(): string {
  return "5%";
}
