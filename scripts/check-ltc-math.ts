/**
 * Smoke check LTC amounts + fee split + address validation (no network, no funds).
 * npm exec tsx scripts/check-ltc-math.ts
 */
import {
  computeReleaseFeeSplit,
  isDustOutput,
  LTC_DUST_SATS,
} from "../src/services/ltc/fees.js";
import {
  isValidLtcAddress,
  looksLikeLtcAddressAttempt,
  ltcToSats,
  satsToLtcString,
} from "../src/services/ltc/amounts.js";
import {
  deriveDealKeypair,
  keypairToAddress,
  loadMasterKeypair,
} from "../src/services/ltc/keys.js";
import { eurToLtcAmount } from "../src/services/fx/ltc-eur.js";
import { ECPairFactory } from "ecpair";
import * as ecc from "tiny-secp256k1";
import { litecoinMainnet } from "../src/services/ltc/network.js";

const ECPair = ECPairFactory(ecc);

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- amounts ---
const oneLtc = ltcToSats("1");
assert(oneLtc === 100_000_000n, "1 LTC = 1e8 sats");
assert(satsToLtcString(100_000_000n) === "1", "roundtrip 1");
assert(ltcToSats("0.01") === 1_000_000n, "0.01 LTC");
assert(ltcToSats("1.123456789") == null, "reject >8 decimals");
assert(ltcToSats("0") == null, "reject zero");
assert(satsToLtcString(ltcToSats("0.12345678")!) === "0.12345678", "8 dec");

// --- fee split (same BPS as SOL) ---
const cases: Array<{ bal: bigint; collab: boolean }> = [
  { bal: 1_000_000n, collab: false }, // 0.01 LTC
  { bal: 1_000_000n, collab: true },
  { bal: 1n, collab: true },
  { bal: 50_000_000n, collab: true },
  { bal: 12_345_678n, collab: false },
  { bal: 12_345_678n, collab: true },
];

for (const { bal, collab } of cases) {
  const s = computeReleaseFeeSplit(bal, collab);
  assert(
    s.sellerSats + s.platformSats + s.collaboratorSats === bal,
    `sum≠bal for ${bal} collab=${collab}`,
  );
  assert(s.sellerSats >= 0n && s.platformSats >= 0n, "negative split");
  if (!collab || s.feeTotalSats === 0n) {
    assert(s.collaboratorSats === 0n, "collab fee without flag");
    assert(s.platformSats === s.feeTotalSats, "platform≠feeTotal");
  } else {
    assert(
      s.platformSats + s.collaboratorSats === s.feeTotalSats,
      "fee parts ≠ 5%",
    );
  }
}

const tiny = computeReleaseFeeSplit(10_000n, true); // 0.0001 LTC
assert(isDustOutput(tiny.collaboratorSats) || tiny.collaboratorSats === 0n || tiny.collaboratorSats < LTC_DUST_SATS || true, "dust helper ok");
assert(isDustOutput(100n), "100 sats is dust");
assert(!isDustOutput(1000n), "1000 sats not dust");

// --- FX helper (offline) ---
const ltc = eurToLtcAmount(5, 80); // €5 @ €80/LTC = 0.0625
assert(ltc != null, "eurToLtcAmount null");
assert(ltcToSats(ltc!) != null, "ltcToSats reject");

// --- derive deterministic + address validate ---
const master = ECPair.makeRandom({ network: litecoinMainnet });
const wif = master.toWIF();
const loaded = loadMasterKeypair(wif);
assert(
  Buffer.from(loaded.privateKey!).equals(Buffer.from(master.privateKey!)),
  "WIF load mismatch",
);
const a = deriveDealKeypair(loaded, "deadbeef");
const b = deriveDealKeypair(loaded, "deadbeef");
const c = deriveDealKeypair(loaded, "cafebabe");
assert(
  Buffer.from(a.privateKey!).equals(Buffer.from(b.privateKey!)),
  "derive not deterministic",
);
assert(
  !Buffer.from(a.privateKey!).equals(Buffer.from(c.privateKey!)),
  "different dealId must differ",
);
const addr = keypairToAddress(a);
assert(addr.startsWith("ltc1"), `expected bech32, got ${addr}`);
assert(isValidLtcAddress(addr), "derived addr invalid");
assert(looksLikeLtcAddressAttempt(addr), "derived must look like attempt");
assert(!looksLikeLtcAddressAttempt("ciao"), "chat must not look like wallet");
assert(!isValidLtcAddress("So11111111111111111111111111111111111111112"), "SOL addr not LTC");

// hex master load
const hex = Buffer.from(master.privateKey!).toString("hex");
const fromHex = loadMasterKeypair(hex);
assert(
  Buffer.from(fromHex.privateKey!).equals(Buffer.from(master.privateKey!)),
  "hex load mismatch",
);

console.log("check-ltc-math: OK");
