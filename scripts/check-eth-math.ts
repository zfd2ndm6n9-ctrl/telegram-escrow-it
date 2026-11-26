/**
 * Smoke check ETH amounts + fee split + address validation (no network, no funds).
 * npm exec tsx scripts/check-eth-math.ts
 */
import {
  computeReleaseFeeSplit,
  isDustOutput,
  ETH_DUST_WEI,
} from "../src/services/eth/fees.js";
import {
  isValidEthAddress,
  looksLikeEthAddressAttempt,
  ethToWei,
  weiToEthString,
} from "../src/services/eth/amounts.js";
import {
  deriveDealWallet,
  loadMasterWallet,
  walletToAddress,
} from "../src/services/eth/keys.js";
import { eurToEthAmount } from "../src/services/fx/eth-eur.js";
import { Wallet } from "ethers";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// --- amounts ---
const oneEth = ethToWei("1");
assert(oneEth === 10n ** 18n, "1 ETH = 1e18 wei");
assert(weiToEthString(10n ** 18n) === "1", "roundtrip 1");
assert(ethToWei("0.01") === 10n ** 16n, "0.01 ETH");
assert(ethToWei("1.1234567890123456789") == null, "reject >18 decimals");
assert(ethToWei("0") == null, "reject zero");
assert(
  weiToEthString(ethToWei("0.123456789012345678")!) === "0.123456789012345678",
  "18 dec",
);

// --- fee split (same BPS as SOL/LTC) ---
const cases: Array<{ bal: bigint; collab: boolean }> = [
  { bal: 10n ** 16n, collab: false }, // 0.01 ETH
  { bal: 10n ** 16n, collab: true },
  { bal: 1n, collab: true },
  { bal: 5n * 10n ** 17n, collab: true },
  { bal: 12_345_678_901_234_567n, collab: false },
  { bal: 12_345_678_901_234_567n, collab: true },
];

for (const { bal, collab } of cases) {
  const s = computeReleaseFeeSplit(bal, collab);
  assert(
    s.sellerWei + s.platformWei + s.collaboratorWei === bal,
    `sum≠bal for ${bal} collab=${collab}`,
  );
  assert(s.sellerWei >= 0n && s.platformWei >= 0n, "negative split");
  if (!collab || s.feeTotalWei === 0n) {
    assert(s.collaboratorWei === 0n, "collab fee without flag");
    assert(s.platformWei === s.feeTotalWei, "platform≠feeTotal");
  } else {
    assert(
      s.platformWei + s.collaboratorWei === s.feeTotalWei,
      "fee parts ≠ 5%",
    );
  }
}

assert(isDustOutput(100n), "tiny wei is dust");
assert(!isDustOutput(ETH_DUST_WEI), "at dust threshold not dust (strict <)");
assert(!isDustOutput(ETH_DUST_WEI + 1n), "above dust ok");

// --- FX helper (offline) ---
const eth = eurToEthAmount(5, 2500); // €5 @ €2500/ETH = 0.002
assert(eth != null, "eurToEthAmount null");
assert(ethToWei(eth!) != null, "ethToWei reject");

// --- derive deterministic + address validate ---
const master = Wallet.createRandom();
const loaded = loadMasterWallet(master.privateKey);
assert(
  loaded.privateKey.toLowerCase() === master.privateKey.toLowerCase(),
  "hex load mismatch",
);
const a = deriveDealWallet(loaded, "deadbeef");
const b = deriveDealWallet(loaded, "deadbeef");
const c = deriveDealWallet(loaded, "cafebabe");
assert(
  a.privateKey === b.privateKey,
  "derive not deterministic",
);
assert(
  a.privateKey !== c.privateKey,
  "different dealId must differ",
);
const addr = walletToAddress(a);
assert(addr.startsWith("0x") && addr.length === 42, `expected 0x addr, got ${addr}`);
assert(isValidEthAddress(addr), "derived addr invalid");
assert(looksLikeEthAddressAttempt(addr), "derived must look like attempt");
assert(!looksLikeEthAddressAttempt("ciao"), "chat must not look like wallet");
assert(
  !isValidEthAddress("So11111111111111111111111111111111111111112"),
  "SOL addr not ETH",
);
assert(!isValidEthAddress("ltc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"), "LTC not ETH");

// bare hex master load
const bare = master.privateKey.slice(2);
const fromBare = loadMasterWallet(bare);
assert(
  fromBare.privateKey.toLowerCase() === master.privateKey.toLowerCase(),
  "bare hex load mismatch",
);

console.log("check-eth-math: OK");
