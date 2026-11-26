/**
 * Smoke: group compromise mark + freeze + error classifiers.
 * npm exec tsx scripts/check-group-compromise.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isBotKickedOrChatGoneError,
  isGroupActionsFrozen,
  isMessageMissingError,
  isTerminalDeal,
  markGroupCompromised,
} from "../src/services/group-compromise.js";
import { DealStore } from "../src/store/deals.js";
import type { Deal } from "../src/types.js";
import { it } from "../src/messages/it.js";

const dir = mkdtempSync(join(tmpdir(), "escrow-compromise-"));
const store = new DealStore(dir);

const base: Deal = {
  id: "abcd1234",
  creatorId: 10,
  creatorRole: "buyer",
  buyerId: 10,
  sellerId: 20,
  amount: "0.1",
  asset: "SOL",
  status: "funded",
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  groupChatId: -100123,
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

store.upsert(base);

// classifiers
assert.equal(
  isBotKickedOrChatGoneError({ description: "Forbidden: bot was kicked from the group chat" }),
  true,
);
assert.equal(
  isBotKickedOrChatGoneError({ description: "Bad Request: chat not found" }),
  true,
);
assert.equal(
  isMessageMissingError({ description: "Bad Request: message to edit not found" }),
  true,
);
assert.equal(isMessageMissingError({ description: "message is not modified" }), false);

// terminal skip
const released = store.upsert({ ...base, id: "deadbeef", status: "released" });
assert.equal(isTerminalDeal(released), true);

let dmCalls = 0;
const fakeApi = {
  sendMessage: async () => {
    dmCalls += 1;
    throw new Error("DM must not be sent on group compromise");
  },
} as never;

const afterTerm = await markGroupCompromised(
  fakeApi,
  store,
  released,
  "bot_kicked",
);
assert.equal(afterTerm.groupCompromisedAt, undefined, "terminal: no mark");

// live deal mark (idempotent) — freeze only, no admin DM
const live = store.get("abcd1234")!;
assert.equal(isGroupActionsFrozen(live), false);

const marked = await markGroupCompromised(fakeApi, store, live, "bot_kicked");
assert.ok(marked.groupCompromisedAt);
assert.equal(marked.groupCompromisedReason, "bot_kicked");
assert.equal(isGroupActionsFrozen(marked), true);
assert.equal(dmCalls, 0, "no admin DM on first compromise mark");

const again = await markGroupCompromised(
  fakeApi,
  store,
  marked,
  "critical_msgs_deleted",
);
assert.equal(
  again.groupCompromisedReason,
  "bot_kicked",
  "reason sticky first-wins",
);
assert.equal(again.groupCompromisedAt, marked.groupCompromisedAt);
assert.equal(dmCalls, 0, "no admin DM on idempotent re-mark");

assert.match(it.frozenGroupCompromised, /congelato/i);

rmSync(dir, { recursive: true, force: true });
console.log("check-group-compromise: ok");
