/**
 * Smoke: A1 — helper auto-bind; manual → pending + creator confirm/reject.
 * npm exec tsx scripts/check-counterpart-confirm-bind.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { counterpartBindConfirmKeyboard } from "../src/keyboards/menus.js";
import { it } from "../src/messages/it.js";
import {
  applyCounterpartConfirm,
  applyCounterpartReject,
  avviaAutoBindReply,
  isHelperSafeAutoBind,
  shouldSendAvviaAutoBindStatus,
} from "../src/services/group-setup.js";
import { DealStore } from "../src/store/deals.js";
import type { Deal } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "escrow-cpbind-"));
const store = new DealStore(dir);
const ts = new Date().toISOString();

const helperDeal: Deal = {
  id: "helper01",
  creatorId: 1,
  creatorRole: "buyer",
  buyerId: 1,
  amount: "",
  asset: "SOL",
  status: "awaiting_counterpart",
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: ts,
  updatedAt: ts,
  groupCreatedVia: "helper",
  counterpartInviteLink: "https://t.me/+helper",
  groupChatId: -1001,
};
assert.equal(isHelperSafeAutoBind(helperDeal), true);

const manualDeal: Deal = {
  ...helperDeal,
  id: "manual01",
  groupCreatedVia: "manual",
  counterpartInviteLink: undefined,
};
assert.equal(isHelperSafeAutoBind(manualDeal), false);

store.upsert(manualDeal);
const parked =
  store.update("manual01", {
    pendingCounterpartUserId: 42,
    pendingCounterpartUsername: "alice",
    pendingCounterpartDisplayName: "Alice",
  }) ?? store.get("manual01")!;

assert.equal(parked.pendingCounterpartUserId, 42);

const notCreator = applyCounterpartConfirm(store, parked, 99);
assert.equal(notCreator.ok, false);
if (!notCreator.ok) assert.equal(notCreator.reason, "not_creator");

const confirmed = applyCounterpartConfirm(store, parked, 1);
assert.equal(confirmed.ok, true);
if (confirmed.ok) {
  assert.equal(confirmed.deal.sellerId, 42);
  assert.equal(confirmed.deal.sellerUsername, "alice");
  assert.equal(confirmed.deal.pendingCounterpartUserId, undefined);
}

store.upsert({
  ...manualDeal,
  id: "manual02",
  pendingCounterpartUserId: 77,
  pendingCounterpartUsername: "bob",
});
const live = store.get("manual02")!;
const rejected = applyCounterpartReject(store, live, 1);
assert.equal(rejected.ok, true);
if (rejected.ok) {
  assert.equal(rejected.rejectedUserId, 77);
  assert.equal(rejected.deal.pendingCounterpartUserId, undefined);
}

const ask = avviaAutoBindReply("need_confirm", {
  id: "manual01",
  creatorRole: "buyer",
  pendingCounterpartUserId: 42,
  pendingCounterpartUsername: "alice",
});
assert.match(ask, /alice/i);
assert.match(ask, /Confermi/i);
assert.equal(shouldSendAvviaAutoBindStatus("need_confirm", 1, 1), true);

const kb = counterpartBindConfirmKeyboard("abcd");
const row = kb.inline_keyboard[0] ?? [];
assert.equal(row.length, 2);
assert.equal(row[0]?.callback_data, "cpbind:yes:abcd");
assert.equal(row[1]?.callback_data, "cpbind:no:abcd");

assert.match(it.counterpartConfirmOnlyCreator, /creato/i);

rmSync(dir, { recursive: true, force: true });
console.log("check-counterpart-confirm-bind: ok");
