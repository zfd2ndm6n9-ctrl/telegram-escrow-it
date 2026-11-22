export {
  getSolanaConnection,
  getMasterKeypair,
  getDealEscrowAddress,
  getDealEscrowKeypair,
  isSolanaConfigured,
} from "./client.js";
export {
  solToLamports,
  lamportsToSolString,
  isValidSolAddress,
  looksLikeSolAddressAttempt,
} from "./amounts.js";
export {
  payoutDealSol,
  getEscrowBalanceLamports,
  getPlatformFeeWalletPubkey,
  classifyPayoutError,
  type PayoutKind,
  type PayoutOptions,
  type TransferResult,
} from "./transfer.js";
export {
  computeReleaseFeeSplit,
  cannotFundNewAccount,
  PLATFORM_FEE_BPS,
  COLLAB_FEE_BPS,
  feeBpsLabel,
} from "./fees.js";
export {
  startDepositWatcher,
  checkDealDeposit,
  type DepositWatcherHandle,
} from "./deposit-watcher.js";
export { loadMasterKeypair, deriveDealKeypair } from "./keys.js";
