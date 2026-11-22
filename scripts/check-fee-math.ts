/**
 * Smoke check fee split + EUR→SOL parse roundtrip (no network).
 * npm exec tsx scripts/check-fee-math.ts
 */
import {
  cannotFundNewAccount,
  computeReleaseFeeSplit,
} from "../src/services/solana/fees.js";
import { solToLamports } from "../src/services/solana/amounts.js";
import { eurToSolAmount } from "../src/services/fx/sol-eur.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const cases: Array<{ bal: bigint; collab: boolean }> = [
  { bal: 10_000_000n, collab: false }, // 0.01 SOL
  { bal: 10_000_000n, collab: true },
  { bal: 1n, collab: true },
  { bal: 50_000_000n, collab: true },
  { bal: 123_456_789n, collab: false },
  { bal: 123_456_789n, collab: true },
];

for (const { bal, collab } of cases) {
  const s = computeReleaseFeeSplit(bal, collab);
  assert(
    s.sellerLamports + s.platformLamports + s.collaboratorLamports === bal,
    `sum≠bal for ${bal} collab=${collab}`,
  );
  assert(s.sellerLamports >= 0n && s.platformLamports >= 0n, "negative split");
  assert(s.collaboratorLamports >= 0n, "neg collab");
  if (!collab || s.feeTotalLamports === 0n) {
    assert(s.collaboratorLamports === 0n, "collab fee without flag");
    assert(s.platformLamports === s.feeTotalLamports, "platform≠feeTotal");
  } else {
    assert(
      s.platformLamports + s.collaboratorLamports === s.feeTotalLamports,
      "fee parts ≠ 5%",
    );
  }
}

// Rent gate: empty KEYTEST-style wallet + tiny 2.5% must fold
const rent = 650_240n;
const tinyCollab = computeReleaseFeeSplit(10_000_000n, true); // 0.01 SOL → 250k collab
assert(tinyCollab.collaboratorLamports === 250_000n, "expected 2.5% of 0.01");
assert(
  cannotFundNewAccount(false, tinyCollab.collaboratorLamports, rent),
  "empty wallet + sub-rent collab must fold",
);
assert(
  !cannotFundNewAccount(true, tinyCollab.collaboratorLamports, rent),
  "existing wallet accepts dust",
);
assert(
  !cannotFundNewAccount(false, rent, rent),
  "exact rent creates account",
);

const sol = eurToSolAmount(5, 150);
assert(sol != null, "eurToSolAmount null");
assert(solToLamports(sol!) != null, "solToLamports reject");

console.log("check-fee-math: OK");
