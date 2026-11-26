import { config } from "../../config.js";
import {
  deriveDealKeypair,
  keypairToAddress,
  loadMasterKeypair,
  type LtcKeypair,
} from "./keys.js";

let masterKeypair: LtcKeypair | undefined;
let masterLoadAttempted = false;

export function isLtcConfigured(): boolean {
  return Boolean(config.ltcPrivateKey?.trim());
}

/** Carica (lazy) la keypair master. Ritorna null se non configurata. */
export function getMasterKeypair(): LtcKeypair | null {
  if (masterKeypair) return masterKeypair;
  if (masterLoadAttempted) return null;
  masterLoadAttempted = true;

  const raw = config.ltcPrivateKey?.trim();
  if (!raw) {
    console.warn("LTC_PRIVATE_KEY non impostata: escrow LTC disabilitato.");
    return null;
  }

  try {
    masterKeypair = loadMasterKeypair(raw);
    console.log(`Litecoin master wallet (MAINNET): ${keypairToAddress(masterKeypair)}`);
    return masterKeypair;
  } catch (err) {
    console.error(
      "LTC_PRIVATE_KEY non valida:",
      err instanceof Error ? err.message : "parse failed",
    );
    return null;
  }
}

export function getDealEscrowKeypair(dealId: string): LtcKeypair | null {
  const master = getMasterKeypair();
  if (!master) return null;
  return deriveDealKeypair(master, dealId);
}

export function getDealEscrowAddress(dealId: string): string | null {
  const kp = getDealEscrowKeypair(dealId);
  return kp ? keypairToAddress(kp) : null;
}

/** Solo per test / reset moduli. */
export function _resetLtcClientForTests(): void {
  masterKeypair = undefined;
  masterLoadAttempted = false;
}
