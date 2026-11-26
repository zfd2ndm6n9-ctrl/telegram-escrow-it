import { config } from "../../config.js";
import {
  deriveDealWallet,
  loadMasterWallet,
  walletToAddress,
} from "./keys.js";
import type { Wallet } from "ethers";

let masterWallet: Wallet | undefined;
let masterLoadAttempted = false;

export function isEthConfigured(): boolean {
  return Boolean(config.ethPrivateKey?.trim());
}

/** Carica (lazy) la wallet master. Ritorna null se non configurata. */
export function getMasterWallet(): Wallet | null {
  if (masterWallet) return masterWallet;
  if (masterLoadAttempted) return null;
  masterLoadAttempted = true;

  const raw = config.ethPrivateKey?.trim();
  if (!raw) {
    console.warn("ETH_PRIVATE_KEY non impostata: escrow ETH disabilitato.");
    return null;
  }

  try {
    masterWallet = loadMasterWallet(raw);
    console.log(`Ethereum master wallet (MAINNET): ${walletToAddress(masterWallet)}`);
    return masterWallet;
  } catch (err) {
    console.error(
      "ETH_PRIVATE_KEY non valida:",
      err instanceof Error ? err.message : "parse failed",
    );
    return null;
  }
}

export function getDealEscrowWallet(dealId: string): Wallet | null {
  const master = getMasterWallet();
  if (!master) return null;
  return deriveDealWallet(master, dealId);
}

export function getDealEscrowAddress(dealId: string): string | null {
  const w = getDealEscrowWallet(dealId);
  return w ? walletToAddress(w) : null;
}

/** Solo per test / reset moduli. */
export function _resetEthClientForTests(): void {
  masterWallet = undefined;
  masterLoadAttempted = false;
}
