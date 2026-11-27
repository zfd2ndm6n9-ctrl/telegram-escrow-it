/**
 * Smoke: C1 remap @ — deal protetti non passano a un nuovo userId;
 * reclaim bloccato se previous ha funded/awaiting_deposit/voti.
 * npm exec tsx scripts/check-remap-protected.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DealStore } from "../src/store/deals.js";
import { MemberStore } from "../src/store/members.js";
import type { Deal } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "escrow-remap-"));
const deals = new DealStore(dir);
const members = new MemberStore(dir);

const ts = new Date().toISOString();
const base = {
  creatorId: 100,
  creatorRole: "buyer" as const,
  buyerId: 100,
  sellerId: 200,
  amount: "0.1",
  asset: "SOL" as const,
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [] as number[],
  refundVotes: [] as number[],
  createdAt: ts,
  updatedAt: ts,
};

const funded: Deal = {
  ...base,
  id: "funded001",
  status: "funded",
};
const awaiting: Deal = {
  ...base,
  id: "awaitdep1",
  status: "awaiting_deposit",
};
const idle: Deal = {
  ...base,
  id: "idle0001",
  status: "awaiting_tos",
};
const closed: Deal = {
  ...base,
  id: "closed01",
  status: "released",
};
const voted: Deal = {
  ...base,
  id: "voted001",
  status: "awaiting_seller_wallet",
  releaseVotes: [100],
};

deals.upsert(funded);
deals.upsert(awaiting);
deals.upsert(idle);
deals.upsert(closed);
deals.upsert(voted);

assert.equal(deals.isRemapProtected(funded), true);
assert.equal(deals.isRemapProtected(awaiting), true);
assert.equal(deals.isRemapProtected(idle), false);
assert.equal(deals.isRemapProtected(closed), false);
assert.equal(deals.isRemapProtected(voted), true, "votes protect even pre-funded");
assert.equal(deals.userOwnsRemapProtectedDeals(100), true);
assert.equal(deals.userOwnsRemapProtectedDeals(999), false);

const n = deals.remapUserId(100, 999);
assert.equal(n, 2, "only idle+closed remapped");
assert.equal(deals.get("funded001")!.buyerId, 100, "funded stays on old id");
assert.equal(deals.get("awaitdep1")!.buyerId, 100);
assert.equal(deals.get("voted001")!.buyerId, 100);
assert.equal(deals.get("idle0001")!.buyerId, 999);
assert.equal(deals.get("closed01")!.buyerId, 999);
assert.equal(deals.get("idle0001")!.creatorId, 999);

// Member reclaim: profilo NON trasferito se deal protetti
members.registerWithUsername(100, "mario");
const blocked = members.registerWithUsername(777, "mario", {
  allowProfileTransfer: (prev) => !deals.userOwnsRemapProtectedDeals(prev),
});
assert.equal(blocked.reclaimBlocked, true);
assert.equal(blocked.previousUserId, undefined);
assert.equal(blocked.member.userId, 777);
assert.equal(members.get(100)?.username, undefined, "old @ cleared");
assert.equal(members.findByUsername("mario")?.userId, 777);

// Soft reclaim OK quando nessun deal protetto sul previous
const dir2 = mkdtempSync(join(tmpdir(), "escrow-remap2-"));
const deals2 = new DealStore(dir2);
const members2 = new MemberStore(dir2);
deals2.upsert({
  ...base,
  id: "softidle",
  status: "cancelled",
  creatorId: 10,
  buyerId: 10,
  sellerId: 20,
});
members2.registerWithUsername(10, "lucia");
const soft = members2.registerWithUsername(55, "lucia", {
  allowProfileTransfer: (prev) => !deals2.userOwnsRemapProtectedDeals(prev),
});
assert.equal(soft.reclaimBlocked, undefined);
assert.equal(soft.previousUserId, 10);
assert.equal(soft.reconnected, true);
const remapped = deals2.remapUserId(10, 55);
assert.equal(remapped, 1);
assert.equal(deals2.get("softidle")!.buyerId, 55);

// Stesso userId, tanti cambi @: ownership resta stabile
members2.refreshUsername(55, "lucia2");
members2.refreshUsername(55, "lucia3");
assert.equal(members2.get(55)?.username, "lucia3");
assert.equal(deals2.get("softidle")!.buyerId, 55);

rmSync(dir, { recursive: true, force: true });
rmSync(dir2, { recursive: true, force: true });
console.log("check-remap-protected: ok");
