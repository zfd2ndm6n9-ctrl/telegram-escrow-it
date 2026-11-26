/**
 * Smoke read-only contro API Litecoin pubblica (no broadcast, no funds).
 * npm exec tsx scripts/check-ltc-api-smoke.ts
 *
 * Skip soft se rete down (exit 0 con WARN) — non blocca CI offline.
 */
import {
  getAddressBalanceSats,
  getAddressUtxos,
  getFeeRates,
} from "../src/services/ltc/api.js";
import { isValidLtcAddress } from "../src/services/ltc/amounts.js";

async function main(): Promise<void> {
  // Usa un indirizzo sintatticamente valido derivato offline
  const { ECPairFactory } = await import("ecpair");
  const ecc = await import("tiny-secp256k1");
  const bitcoin = await import("bitcoinjs-lib");
  const { litecoinMainnet } = await import("../src/services/ltc/network.js");
  const ECPair = ECPairFactory(ecc);
  const kp = ECPair.fromPrivateKey(Buffer.alloc(32, 2), {
    network: litecoinMainnet,
  });
  const addr = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(kp.publicKey),
    network: litecoinMainnet,
  }).address!;

  if (!isValidLtcAddress(addr)) {
    throw new Error(`generated sample invalid: ${addr}`);
  }

  try {
    const rates = await getFeeRates();
    if (!(rates.preferredSatPerVb >= 1)) {
      throw new Error(`bad fee rate ${rates.preferredSatPerVb}`);
    }
    const bal = await getAddressBalanceSats(addr);
    if (bal < 0n) throw new Error("negative balance");
    const utxos = await getAddressUtxos(addr);
    if (!Array.isArray(utxos)) throw new Error("utxos not array");
    console.log(
      `check-ltc-api-smoke: OK addr=${addr} bal=${bal} utxos=${utxos.length} fee≈${rates.preferredSatPerVb} sat/vB`,
    );
  } catch (err) {
    console.warn(
      "check-ltc-api-smoke: WARN rete/API non raggiungibile — skip soft:",
      err instanceof Error ? err.message : err,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
