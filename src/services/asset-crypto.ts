/**
 * Dispatch multi-asset (SOL / LTC / ETH) per wallet, FX lock, deposit check, payout.
 */

import type { Asset, Deal } from "../types.js";
import { convertPriceEurToSol } from "./fx/sol-eur.js";
import { convertPriceEurToLtc } from "./fx/ltc-eur.js";
import { convertPriceEurToEth } from "./fx/eth-eur.js";
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
import {
  checkDealDepositLtc,
  getEscrowBalanceSats,
  isValidLtcAddress,
  looksLikeLtcAddressAttempt,
  satsToLtcString,
  payoutDealLtc,
  classifyPayoutError as classifyLtcPayoutError,
  isLtcConfigured,
  getDealEscrowAddress as getLtcEscrowAddress,
  type TransferResult as LtcTransferResult,
} from "./ltc/index.js";
import {
  checkDealDepositEth,
  getEscrowBalanceWei,
  isValidEthAddress,
  looksLikeEthAddressAttempt,
  weiToEthString,
  payoutDealEth,
  classifyPayoutError as classifyEthPayoutError,
  isEthConfigured,
  getDealEscrowAddress as getEthEscrowAddress,
  type TransferResult as EthTransferResult,
} from "./eth/index.js";

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
  return isSolanaConfigured() || isLtcConfigured() || isEthConfigured();
}

export function isAssetConfigured(asset: Asset): boolean {
  if (asset === "SOL") return isSolanaConfigured();
  if (asset === "LTC") return isLtcConfigured();
  if (asset === "ETH") return isEthConfigured();
  return false;
}

export async function getEscrowAddressForAsset(
  asset: Asset,
  dealId: string,
): Promise<string | null> {
  if (asset === "SOL") return getSolEscrowAddress(dealId);
  if (asset === "LTC") return getLtcEscrowAddress(dealId);
  if (asset === "ETH") return getEthEscrowAddress(dealId);
  return null;
}

export function isValidWalletForAsset(asset: Asset, value: string): boolean {
  if (asset === "SOL") return isValidSolAddress(value);
  if (asset === "LTC") return isValidLtcAddress(value);
  if (asset === "ETH") return isValidEthAddress(value);
  return false;
}

export function looksLikeWalletAttempt(asset: Asset, value: string): boolean {
  if (asset === "SOL") return looksLikeSolAddressAttempt(value);
  if (asset === "LTC") return looksLikeLtcAddressAttempt(value);
  if (asset === "ETH") return looksLikeEthAddressAttempt(value);
  return false;
}

export async function convertPriceEurToAsset(
  asset: Asset,
  priceEur: string,
): Promise<string | null> {
  if (asset === "SOL") return convertPriceEurToSol(priceEur);
  if (asset === "LTC") return convertPriceEurToLtc(priceEur);
  if (asset === "ETH") return convertPriceEurToEth(priceEur);
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
  if (deal.asset === "LTC") {
    const r = await checkDealDepositLtc(store, deal.id);
    if (!r.ok) return r;
    return {
      ok: true,
      funded: r.funded,
      balanceStr: r.balanceLtc,
      expectedStr: r.expectedLtc,
    };
  }
  if (deal.asset === "ETH") {
    const r = await checkDealDepositEth(store, deal.id);
    if (!r.ok) return r;
    return {
      ok: true,
      funded: r.funded,
      balanceStr: r.balanceEth,
      expectedStr: r.expectedEth,
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
  if (deal.asset === "LTC") {
    return getEscrowBalanceSats(deal.escrowAddress);
  }
  if (deal.asset === "ETH") {
    return getEscrowBalanceWei(deal.escrowAddress);
  }
  return 0n;
}

export function formatBaseUnits(deal: Deal, units: bigint): string {
  if (deal.asset === "LTC") return satsToLtcString(units);
  if (deal.asset === "ETH") return weiToEthString(units);
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
  if (deal.asset === "LTC") {
    // Invite collab wallets are SOL today — only pass through if LTC address.
    const collab =
      options.collaboratorWallet &&
      isValidLtcAddress(options.collaboratorWallet)
        ? options.collaboratorWallet
        : undefined;
    const r: LtcTransferResult = await payoutDealLtc(deal.id, toAddress, {
      kind: options.kind,
      collaboratorWallet: collab,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      signature: r.signature,
      amountStr: r.ltc,
      paidBaseUnits: r.sats,
      kind: r.kind,
      sellerBaseUnits: r.sellerSats,
      platformFeeBaseUnits: r.platformFeeSats,
      collaboratorFeeBaseUnits: r.collaboratorFeeSats,
      feeWallet: r.feeWallet,
      collaboratorWallet: r.collaboratorWallet,
      collaboratorFeeFoldedToPlatform: r.collaboratorFeeFoldedToPlatform,
    };
  }
  if (deal.asset === "ETH") {
    // Invite collab wallets are SOL today — only pass through if ETH address.
    const collab =
      options.collaboratorWallet &&
      isValidEthAddress(options.collaboratorWallet)
        ? options.collaboratorWallet
        : undefined;
    const r: EthTransferResult = await payoutDealEth(deal.id, toAddress, {
      kind: options.kind,
      collaboratorWallet: collab,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      signature: r.signature,
      amountStr: r.eth,
      paidBaseUnits: r.wei,
      kind: r.kind,
      sellerBaseUnits: r.sellerWei,
      platformFeeBaseUnits: r.platformFeeWei,
      collaboratorFeeBaseUnits: r.collaboratorFeeWei,
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
  if (asset === "LTC") return classifyLtcPayoutError(err);
  if (asset === "ETH") return classifyEthPayoutError(err);
  return classifySolPayoutError(err);
}

/** Explorer URL per tx di payout. */
export function payoutExplorerUrl(deal: Deal, txid: string): string {
  if (deal.asset === "LTC") {
    return `https://litecoinspace.org/tx/${txid}`;
  }
  if (deal.asset === "ETH") {
    return `https://etherscan.io/tx/${txid}`;
  }
  return `https://solscan.io/tx/${txid}`;
}

/** Decimali max per parse importo on-chain per asset. */
export function assetMaxDecimals(asset: Asset): number {
  if (asset === "LTC") return 8;
  if (asset === "ETH") return 18;
  return 9;
}
