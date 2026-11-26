export {
  getDealEscrowAddress,
  getDealEscrowKeypair,
  getMasterKeypair,
  isLtcConfigured,
} from "./client.js";
export {
  ltcToSats,
  satsToLtcString,
  isValidLtcAddress,
  looksLikeLtcAddressAttempt,
  LTC_DECIMALS,
  SATS_PER_LTC,
} from "./amounts.js";
export {
  payoutDealLtc,
  getEscrowBalanceSats,
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
  LTC_DUST_SATS,
  feeBpsLabel,
} from "./fees.js";
export {
  startLtcDepositWatcher,
  checkDealDepositLtc,
  type DepositWatcherHandle,
} from "./deposit-watcher.js";
export {
  loadMasterKeypair,
  deriveDealKeypair,
  keypairToAddress,
} from "./keys.js";
export { litecoinMainnet } from "./network.js";
