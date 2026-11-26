/**
 * Client JSON-RPC Ethereum via ethers JsonRpcProvider.
 *
 * Default: https://ethereum.publicnode.com
 * Override: `ETH_RPC_URL` (Helius / Alchemy / Infura / QuickNode consigliati in prod).
 */

import { JsonRpcProvider, type FeeData, type TransactionResponse } from "ethers";
import { config } from "../../config.js";

const FETCH_TIMEOUT_MS = 20_000;

let provider: JsonRpcProvider | undefined;

function rpcUrl(): string {
  return (
    config.ethRpcUrl?.trim() ||
    "https://ethereum.publicnode.com"
  );
}

export function getEthProvider(): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(rpcUrl(), 1, {
      staticNetwork: true,
    });
  }
  return provider;
}

/** Solo per test / reset moduli. */
export function _resetEthProviderForTests(): void {
  provider = undefined;
}

export async function getAddressBalanceWei(address: string): Promise<bigint> {
  const p = getEthProvider();
  return await withTimeout(p.getBalance(address), "getBalance");
}

export async function getFeeData(): Promise<FeeData> {
  const p = getEthProvider();
  return await withTimeout(p.getFeeData(), "getFeeData");
}

/**
 * Stima costo gas per N transfer nativi (21_000 gas ciascuno).
 * Usa maxFeePerGas (EIP-1559) o gasPrice legacy; buffer +20%.
 */
export async function estimateNativeTransferGasReserve(
  transferCount: number,
): Promise<{ gasLimitPerTx: bigint; maxFeePerGas: bigint; reserveWei: bigint }> {
  const count = Math.max(1, transferCount);
  const fee = await getFeeData();
  const maxFee =
    fee.maxFeePerGas ??
    fee.gasPrice ??
    30_000_000_000n; // 30 gwei fallback
  // Floor minimo 1 gwei anti-zero
  const perGas = maxFee > 1_000_000_000n ? maxFee : 1_000_000_000n;
  const gasLimitPerTx = 21_000n;
  const raw = perGas * gasLimitPerTx * BigInt(count);
  const reserveWei = (raw * 120n) / 100n; // +20%
  return { gasLimitPerTx, maxFeePerGas: perGas, reserveWei };
}

export async function waitTx(
  tx: TransactionResponse,
  confirms = 1,
): Promise<string> {
  const receipt = await withTimeout(
    tx.wait(confirms),
    "tx.wait",
    120_000,
  );
  if (!receipt || !receipt.hash) {
    throw new Error("ETH tx senza receipt/hash");
  }
  if (receipt.status === 0) {
    throw new Error(`ETH tx reverted: ${receipt.hash}`);
  }
  return receipt.hash;
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = FETCH_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`ETH RPC timeout (${label})`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
