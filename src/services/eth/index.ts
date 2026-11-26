export {
  getDealEscrowAddress,
  getDealEscrowWallet,
  getMasterWallet,
  isEthConfigured,
} from "./client.js";
export {
  ethToWei,
  weiToEthString,
  isValidEthAddress,
  looksLikeEthAddressAttempt,
  checksumEthAddress,
  ETH_DECIMALS,
  WEI_PER_ETH,
} from "./amounts.js";
export {
  payoutDealEth,
  getEscrowBalanceWei,
  getPlatformFeeWalletAddress,
  classifyPayoutError,
  type PayoutKind,
  type PayoutOptions,
  type TransferResult,
} from "./transfer.js";
export {
  computeReleaseFeeSplit,
  isDustOutput,
  PLATFORM_FEE_BPS,
  COLLAB_FEE_BPS,
  ETH_DUST_WEI,
  feeBpsLabel,
} from "./fees.js";
export {
  startEthDepositWatcher,
  checkDealDepositEth,
  type DepositWatcherHandle,
} from "./deposit-watcher.js";
export {
  loadMasterWallet,
  deriveDealWallet,
  walletToAddress,
} from "./keys.js";
export { getEthProvider, getAddressBalanceWei } from "./rpc.js";
