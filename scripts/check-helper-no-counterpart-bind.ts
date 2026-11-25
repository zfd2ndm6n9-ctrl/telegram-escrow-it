/**
 * Smoke: helper/support (ADMIN_TELEGRAM_IDS) never auto-binds as buyer/seller.
 * npm exec tsx scripts/check-helper-no-counterpart-bind.ts
 */
import assert from "node:assert/strict";
import type { Deal } from "../src/types.js";

process.env.ADMIN_TELEGRAM_ID = "9001";
process.env.ADMIN_TELEGRAM_IDS = "9001,9002";

const {
  assignJoiningParty,
  canBindAsDealParty,
  isSupportHelperUser,
} = await import("../src/services/deal-logic.js");

const HELPER = 9001;
const CREATOR = 100;
const COUNTERPART = 200;

assert.equal(isSupportHelperUser(HELPER), true);
assert.equal(isSupportHelperUser(COUNTERPART), false);

const base = {
  id: "deadbeef",
  creatorId: CREATOR,
  creatorRole: "buyer" as const,
  buyerId: CREATOR,
  amount: "",
  asset: "SOL" as const,
  status: "awaiting_counterpart" as const,
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  groupCreatedVia: "helper" as const,
} satisfies Deal;

assert.equal(canBindAsDealParty(base, HELPER), false);
assert.equal(canBindAsDealParty(base, COUNTERPART), true);
assert.equal(canBindAsDealParty(base, CREATOR), true);

// Helper must not fill the open seller slot
const helperPatch = assignJoiningParty(base, HELPER, "support", "Support");
assert.equal(helperPatch, null, "helper must not bind as seller");

// Real counterpart binds to the open slot
const cpPatch = assignJoiningParty(base, COUNTERPART, "alice", "Alice");
assert.deepEqual(cpPatch, {
  sellerId: COUNTERPART,
  sellerUsername: "alice",
  sellerDisplayName: "Alice",
});

// Already-bound party may refresh username
const bound: Deal = { ...base, sellerId: COUNTERPART, sellerUsername: "old" };
const refresh = assignJoiningParty(bound, COUNTERPART, "alice");
assert.deepEqual(refresh, { sellerUsername: "alice" });

// Admin who opens a deal: already buyer/seller from create — refresh ok,
// never steal the open counterpart slot.
const adminCreatorDeal: Deal = {
  ...base,
  creatorId: HELPER,
  buyerId: HELPER,
  buyerUsername: "support",
  sellerId: undefined,
};
assert.equal(canBindAsDealParty(adminCreatorDeal, HELPER), true);
assert.equal(
  assignJoiningParty(adminCreatorDeal, HELPER, "support"),
  null,
  "already-bound admin creator: no empty-slot fill",
);
assert.equal(
  assignJoiningParty(
    { ...adminCreatorDeal, buyerId: undefined } as Deal,
    HELPER,
    "support",
  ),
  null,
  "helper must never fill an empty slot even if creatorId matches",
);

console.log("check-helper-no-counterpart-bind: ok");
