/**
 * Dispatch asset (SOL native only) per wallet, FX lock, deposit check, payout.
 * USDC / LTC / ETH non supportati.
 */

import type { Asset, Deal } from "../types.js";
import { convertPriceEurToSol } from "./fx/sol-eur.js";
import {
  checkDealDeposit,
  getEscrowBalanceLamports,
  isValidSolAddress,
  looksLikeSolAddressAttempt,
  lamportsToSolString,
  payoutDealSol,
  classifyPayoutError as classifySolPayoutError,
  isSolanaConfigured,
  getDealEscrowAddress as getSolEscrowAddress,
  type TransferResult as SolTransferResult,
} from "./solana/index.js";

export type UnifiedPayoutResult =
  | {
      ok: true;
      signature: string;
      amountStr: string;
      /** Base units paid to primary dest (seller release / buyer refund). */
      paidBaseUnits: bigint;
      kind: "release" | "refund";
      sellerBaseUnits?: bigint;
      platformFeeBaseUnits?: bigint;
      collaboratorFeeBaseUnits?: bigint;
      feeWallet?: string;
      collaboratorWallet?: string;
      collaboratorFeeFoldedToPlatform?: boolean;
    }
  | { ok: false; error: string; errorCode?: string };

export function isAnyEscrowConfigured(): boolean {
  return isSolanaConfigured();
}

export function isAssetConfigured(asset: Asset): boolean {
  return asset === "SOL" && isSolanaConfigured();
}

export async function getEscrowAddressForAsset(
  asset: Asset,
  dealId: string,
): Promise<string | null> {
  if (asset === "SOL") return getSolEscrowAddress(dealId);
  return null;
}

export function isValidWalletForAsset(asset: Asset, value: string): boolean {
  if (asset === "SOL") return isValidSolAddress(value);
  return false;
}

export function looksLikeWalletAttempt(asset: Asset, value: string): boolean {
  if (asset === "SOL") return looksLikeSolAddressAttempt(value);
  return false;
}

export async function convertPriceEurToAsset(
  asset: Asset,
  priceEur: string,
): Promise<string | null> {
  if (asset === "SOL") return convertPriceEurToSol(priceEur);
  return null;
}

export async function checkDealDepositForAsset(
  store: Parameters<typeof checkDealDeposit>[0],
  deal: Deal,
): Promise<
  | { ok: true; funded: boolean; balanceStr: string; expectedStr: string }
  | { ok: false; error: string }
> {
  if (deal.asset === "SOL") {
    const r = await checkDealDeposit(store, deal.id);
    if (!r.ok) return r;
    return {
      ok: true,
      funded: r.funded,
      balanceStr: r.balanceSol,
      expectedStr: r.expectedSol,
    };
  }
  return { ok: false, error: `Asset ${deal.asset} non supportato` };
}

export async function getEscrowBalanceBaseUnits(
  deal: Deal,
): Promise<bigint> {
  if (!deal.escrowAddress) return 0n;
  if (deal.asset === "SOL") {
    return getEscrowBalanceLamports(deal.escrowAddress);
  }
  return 0n;
}

export function formatBaseUnits(deal: Deal, units: bigint): string {
  void deal;
  return lamportsToSolString(units);
}

export async function payoutDealAsset(
  deal: Deal,
  toAddress: string,
  options: {
    kind: "release" | "refund";
    collaboratorWallet?: string;
  },
): Promise<UnifiedPayoutResult> {
  if (deal.asset === "SOL") {
    const r: SolTransferResult = await payoutDealSol(deal.id, toAddress, options);
    if (!r.ok) return r;
    return {
      ok: true,
      signature: r.signature,
      amountStr: r.sol,
      paidBaseUnits: r.lamports,
      kind: r.kind,
      sellerBaseUnits: r.sellerLamports,
      platformFeeBaseUnits: r.platformFeeLamports,
      collaboratorFeeBaseUnits: r.collaboratorFeeLamports,
      feeWallet: r.feeWallet,
      collaboratorWallet: r.collaboratorWallet,
      collaboratorFeeFoldedToPlatform: r.collaboratorFeeFoldedToPlatform,
    };
  }
  return {
    ok: false,
    error: `Asset ${deal.asset} non supportato per payout`,
    errorCode: "unsupported_asset",
  };
}

export function classifyAssetPayoutError(
  asset: Asset,
  err: unknown,
): { code: string; message: string } {
  void asset;
  return classifySolPayoutError(err);
}

/** Explorer URL per tx di payout (Solscan). */
export function payoutExplorerUrl(deal: Deal, txid: string): string {
  void deal;
  return `https://solscan.io/tx/${txid}`;
}

/** Decimali max per parse importo on-chain (SOL = 9). */
export function assetMaxDecimals(asset: Asset): number {
  void asset;
  return 9;
}
