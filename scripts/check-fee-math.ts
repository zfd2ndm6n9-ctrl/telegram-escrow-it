/**
 * Smoke check fee split + deposit gross-up + EUR→SOL parse roundtrip (no network).
 * npm exec tsx scripts/check-fee-math.ts
 */
import {
  cannotFundNewAccount,
  computeReleaseFeeSplit,
  depositLamportsForFeePayer,
  effectiveFeePayer,
  BUYER_GROSS_BPS,
  BPS_DENOMINATOR,
  PLATFORM_FEE_BPS,
} from "../src/services/solana/fees.js";
import { solToLamports } from "../src/services/solana/amounts.js";
import { eurToSolAmount } from "../src/services/fx/sol-eur.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(effectiveFeePayer(undefined) === "seller", "legacy default seller");
assert(effectiveFeePayer("seller") === "seller", "explicit seller");
assert(effectiveFeePayer("buyer") === "buyer", "buyer flag");

/** Bit-identical to main `computeReleaseFeeSplit` before feePayer existed. */
function legacySellerSplit(
  balanceLamports: bigint,
  hasCollaborator: boolean,
): {
  sellerLamports: bigint;
  feeTotalLamports: bigint;
  platformLamports: bigint;
  collaboratorLamports: bigint;
} {
  if (balanceLamports <= 0n) {
    return {
      sellerLamports: 0n,
      feeTotalLamports: 0n,
      platformLamports: 0n,
      collaboratorLamports: 0n,
    };
  }
  const feeTotalLamports =
    (balanceLamports * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
  const sellerLamports = balanceLamports - feeTotalLamports;
  if (!hasCollaborator || feeTotalLamports === 0n) {
    return {
      sellerLamports,
      feeTotalLamports,
      platformLamports: feeTotalLamports,
      collaboratorLamports: 0n,
    };
  }
  const collaboratorLamports =
    (balanceLamports * 250n) / BPS_DENOMINATOR;
  return {
    sellerLamports,
    feeTotalLamports,
    platformLamports: feeTotalLamports - collaboratorLamports,
    collaboratorLamports,
  };
}

// Seller path (and undefined feePayer) must match main legacy exactly.
for (const bal of [
  1n,
  21n,
  10_000_000n,
  50_000_000n,
  123_456_789n,
  999_999_999n,
  1_000_000_000n,
]) {
  for (const collab of [false, true]) {
    for (const payer of [undefined, "seller"] as const) {
      const s = computeReleaseFeeSplit(bal, collab, payer);
      const L = legacySellerSplit(bal, collab);
      assert(
        s.sellerLamports === L.sellerLamports &&
          s.feeTotalLamports === L.feeTotalLamports &&
          s.platformLamports === L.platformLamports &&
          s.collaboratorLamports === L.collaboratorLamports,
        `seller≢legacy bal=${bal} collab=${collab} payer=${payer}`,
      );
    }
  }
  assert(
    depositLamportsForFeePayer(bal, "seller") === bal,
    "seller deposit must equal commercial",
  );
  assert(
    depositLamportsForFeePayer(bal, undefined) === bal,
    "legacy deposit must equal commercial",
  );
}

const cases: Array<{
  bal: bigint;
  collab: boolean;
  feePayer: "buyer" | "seller";
}> = [
  { bal: 10_000_000n, collab: false, feePayer: "seller" },
  { bal: 10_000_000n, collab: true, feePayer: "seller" },
  { bal: 1n, collab: true, feePayer: "seller" },
  { bal: 50_000_000n, collab: true, feePayer: "seller" },
  { bal: 123_456_789n, collab: false, feePayer: "seller" },
  { bal: 123_456_789n, collab: true, feePayer: "seller" },
  // Buyer pays: deposit = commercial + 5%
  { bal: 10_500_000n, collab: false, feePayer: "buyer" },
  { bal: 10_500_000n, collab: true, feePayer: "buyer" },
  { bal: 105_000_000n, collab: true, feePayer: "buyer" },
  { bal: 21n, collab: false, feePayer: "buyer" },
];

for (const { bal, collab, feePayer } of cases) {
  const s = computeReleaseFeeSplit(bal, collab, feePayer);
  assert(
    s.sellerLamports + s.platformLamports + s.collaboratorLamports === bal,
    `sum≠bal for ${bal} collab=${collab} payer=${feePayer}`,
  );
  assert(s.sellerLamports >= 0n && s.platformLamports >= 0n, "negative split");
  assert(s.collaboratorLamports >= 0n, "neg collab");
  assert(s.feePayer === feePayer, "feePayer echo");
  if (!collab || s.feeTotalLamports === 0n) {
    assert(s.collaboratorLamports === 0n, "collab fee without flag");
    assert(s.platformLamports === s.feeTotalLamports, "platform≠feeTotal");
  } else {
    assert(
      s.platformLamports + s.collaboratorLamports === s.feeTotalLamports,
      "fee parts ≠ 5%",
    );
  }
  if (feePayer === "seller") {
    const expectedFee = (bal * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
    assert(s.feeTotalLamports === expectedFee, "seller fee = 5% bal");
  } else {
    const expectedFee = (bal * PLATFORM_FEE_BPS) / BUYER_GROSS_BPS;
    assert(s.feeTotalLamports === expectedFee, "buyer fee = bal×500/10500");
  }
}

// Deposit gross-up: commercial 0.01 SOL → buyer deposits 0.0105
const commercial = 10_000_000n;
assert(
  depositLamportsForFeePayer(commercial, "seller") === commercial,
  "seller deposit = commercial",
);
assert(
  depositLamportsForFeePayer(commercial, "buyer") === 10_500_000n,
  "buyer deposit = commercial + 5%",
);
assert(
  depositLamportsForFeePayer(commercial, undefined) === commercial,
  "legacy deposit = commercial",
);

// Roundtrip: lock buyer deposit → release seller gets commercial
const deposit = depositLamportsForFeePayer(commercial, "buyer");
const release = computeReleaseFeeSplit(deposit, false, "buyer");
assert(release.sellerLamports === commercial, "buyer-pay: seller gets price");
assert(release.feeTotalLamports === 500_000n, "buyer-pay: fee = 5% price");

const releaseCollab = computeReleaseFeeSplit(deposit, true, "buyer");
assert(
  releaseCollab.sellerLamports === commercial,
  "buyer-pay collab: seller gets price",
);
assert(
  releaseCollab.platformLamports === 250_000n &&
    releaseCollab.collaboratorLamports === 250_000n,
  "buyer-pay collab: 2.5/2.5",
);

// Rent gate: empty KEYTEST-style wallet + tiny 2.5% must fold
const rent = 650_240n;
const tinyCollab = computeReleaseFeeSplit(10_000_000n, true, "seller"); // 0.01 SOL → 250k collab
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
