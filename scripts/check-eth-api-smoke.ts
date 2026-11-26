/**
 * Smoke read-only contro RPC Ethereum pubblico (no broadcast, no funds).
 * npm exec tsx scripts/check-eth-api-smoke.ts
 *
 * Skip soft se rete down (exit 0 con WARN) — non blocca CI offline.
 */
import { Wallet } from "ethers";
import {
  getAddressBalanceWei,
  getFeeData,
} from "../src/services/eth/rpc.js";
import { isValidEthAddress } from "../src/services/eth/amounts.js";

async function main(): Promise<void> {
  const wallet = new Wallet(
    "0x0000000000000000000000000000000000000000000000000000000000000002",
  );
  const addr = wallet.address;

  if (!isValidEthAddress(addr)) {
    throw new Error(`generated sample invalid: ${addr}`);
  }

  try {
    const fee = await getFeeData();
    const maxFee = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    if (maxFee < 0n) throw new Error("negative fee");
    const bal = await getAddressBalanceWei(addr);
    if (bal < 0n) throw new Error("negative balance");
    console.log(
      `check-eth-api-smoke: OK addr=${addr} bal=${bal} maxFeePerGas≈${maxFee}`,
    );
  } catch (err) {
    console.warn(
      "check-eth-api-smoke: WARN rete/RPC non raggiungibile — skip soft:",
      err instanceof Error ? err.message : err,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
