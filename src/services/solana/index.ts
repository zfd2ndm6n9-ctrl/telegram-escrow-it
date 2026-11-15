export {
  getSolanaConnection,
  getMasterKeypair,
  getDealEscrowAddress,
  getDealEscrowKeypair,
  isSolanaConfigured,
} from "./client.js";
export { solToLamports, lamportsToSolString, isValidSolAddress } from "./amounts.js";
export { payoutDealSol, getEscrowBalanceLamports } from "./transfer.js";
export {
  startDepositWatcher,
  checkDealDeposit,
  type DepositWatcherHandle,
} from "./deposit-watcher.js";
export { loadMasterKeypair, deriveDealKeypair } from "./keys.js";
