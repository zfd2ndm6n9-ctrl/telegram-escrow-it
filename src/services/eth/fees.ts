/**
 * Fee di servizio sulla RELEASE (non sul refund) — stesso schema SOL/LTC.
 *
 * Totale trattenuto: 5% del saldo spendibile (dopo gas).
 * - Senza invito / senza wallet ETH collab: 5% → FEE_WALLET_ETH
 * - Con collaboratore ETH: 2.5% → fee wallet, 2.5% → collaboratore
 * Seller riceve il 95%.
 */

export const PLATFORM_FEE_BPS = 500n; // 5.00%
export const COLLAB_FEE_BPS = 250n; // 2.50%
export const BPS_DENOMINATOR = 10_000n;

/**
 * Soglia sotto la quale un output fee/collab è troppo piccolo da inviare
 * (gas tipico ~21k * ~gasPrice ≫ pochi wei). Conservativa: 10_000 gwei = 1e13 wei.
 */
export const ETH_DUST_WEI = 10_000_000_000_000n; // 1e13 wei ≈ 0.00001 ETH

export type ReleaseFeeSplit = {
  totalWei: bigint;
  sellerWei: bigint;
  feeTotalWei: bigint;
  platformWei: bigint;
  collaboratorWei: bigint;
  hasCollaborator: boolean;
};

/**
 * Split intero in wei. Arrotonda per difetto sulle fee (seller tiene il resto).
 * Se l'importo è troppo piccolo, fee = 0 e seller prende tutto.
 */
export function computeReleaseFeeSplit(
  balanceWei: bigint,
  hasCollaborator: boolean,
): ReleaseFeeSplit {
  if (balanceWei <= 0n) {
    return {
      totalWei: 0n,
      sellerWei: 0n,
      feeTotalWei: 0n,
      platformWei: 0n,
      collaboratorWei: 0n,
      hasCollaborator: false,
    };
  }

  const feeTotalWei = (balanceWei * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const sellerWei = balanceWei - feeTotalWei;

  if (!hasCollaborator || feeTotalWei === 0n) {
    return {
      totalWei: balanceWei,
      sellerWei,
      feeTotalWei,
      platformWei: feeTotalWei,
      collaboratorWei: 0n,
      hasCollaborator: false,
    };
  }

  const collaboratorWei = (balanceWei * COLLAB_FEE_BPS) / BPS_DENOMINATOR;
  const platformWei = feeTotalWei - collaboratorWei;

  return {
    totalWei: balanceWei,
    sellerWei,
    feeTotalWei,
    platformWei,
    collaboratorWei,
    hasCollaborator: collaboratorWei > 0n,
  };
}

export function feeBpsLabel(): string {
  return "5%";
}

/** Output sotto dust → non creare (piegare su altro output). */
export function isDustOutput(wei: bigint): boolean {
  return wei > 0n && wei < ETH_DUST_WEI;
}
