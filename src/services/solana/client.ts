import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { config } from "../../config.js";
import { deriveDealKeypair, loadMasterKeypair } from "./keys.js";

let connection: Connection | undefined;
let masterKeypair: Keypair | undefined;
let masterLoadAttempted = false;

export function getSolanaConnection(): Connection {
  if (!connection) {
    const url =
      config.solanaRpcUrl?.trim() || clusterApiUrl("mainnet-beta");
    connection = new Connection(url, {
      commitment: "confirmed",
    });
  }
  return connection;
}

export function isSolanaConfigured(): boolean {
  return Boolean(config.solanaPrivateKey?.trim());
}

/** Carica (lazy) la keypair master. Ritorna null se non configurata. */
export async function getMasterKeypair(): Promise<Keypair | null> {
  if (masterKeypair) return masterKeypair;
  if (masterLoadAttempted) return null;
  masterLoadAttempted = true;

  const raw = config.solanaPrivateKey?.trim();
  if (!raw) {
    console.warn(
      "SOLANA_PRIVATE_KEY non impostata: escrow on-chain disabilitato.",
    );
    return null;
  }

  try {
    masterKeypair = await loadMasterKeypair(raw);
    console.log(
      `Solana master wallet (MAINNET): ${masterKeypair.publicKey.toBase58()}`,
    );
    return masterKeypair;
  } catch (err) {
    console.error("SOLANA_PRIVATE_KEY non valida:", err);
    return null;
  }
}

export async function getDealEscrowKeypair(
  dealId: string,
): Promise<Keypair | null> {
  const master = await getMasterKeypair();
  if (!master) return null;
  return deriveDealKeypair(master, dealId);
}

export async function getDealEscrowAddress(
  dealId: string,
): Promise<string | null> {
  const kp = await getDealEscrowKeypair(dealId);
  return kp ? kp.publicKey.toBase58() : null;
}

/** Solo per test / reset moduli. */
export function _resetSolanaClientForTests(): void {
  connection = undefined;
  masterKeypair = undefined;
  masterLoadAttempted = false;
}
