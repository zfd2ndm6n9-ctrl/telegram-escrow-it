/**
 * Smoke: bot-owned groups constants + demote helpers + copy (no Telegram).
 * npm exec tsx scripts/check-bot-owned-groups.ts
 */
import assert from "node:assert/strict";
import {
  BOT_API_CAN_CREATE_GROUPS,
  BOT_API_MEMBER_PERMISSIONS,
  groupCreatorReady,
} from "../src/services/group-creator.js";
import { config } from "../src/config.js";
import { it } from "../src/messages/it.js";
import { groupInviteKeyboard } from "../src/keyboards/menus.js";
import type { Deal } from "../src/types.js";

assert.equal(
  BOT_API_CAN_CREATE_GROUPS,
  false,
  "Bot API cannot create groups — hard limit",
);

assert.equal(BOT_API_MEMBER_PERMISSIONS.can_invite_users, false);
assert.equal(BOT_API_MEMBER_PERMISSIONS.can_change_info, false);
assert.equal(BOT_API_MEMBER_PERMISSIONS.can_pin_messages, false);

// Default prefer create (unless TELEGRAM_BOT_CREATES_GROUPS=0)
assert.equal(typeof config.telegramBotCreatesGroups, "boolean");

const deal = {
  id: "abcd1234",
  creatorId: 1,
  creatorRole: "buyer",
  buyerId: 1,
  sellerId: 2,
  amount: "0.1",
  asset: "SOL",
  status: "awaiting_group",
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as Deal;

const ready = it.groupReady(
  deal,
  {
    creatorLink: "https://t.me/+creator",
    counterpartLink: "https://t.me/+counterpart",
  },
  false,
);
assert.match(ready, /gestito da Escrowita/);
assert.match(ready, /https:\/\/t\.me\/\+creator/);
assert.match(ready, /https:\/\/t\.me\/\+counterpart/);
assert.ok(!/crea un \*gruppo privato\*/i.test(ready));

const missing = it.groupCreateHelperMissing(deal);
assert.match(missing, /Bot API/i);
assert.match(missing, /HELPER_SESSION/);
assert.match(missing, /owner/i);

const fail = it.groupCreateFailed(deal, "boom");
assert.match(fail, /helper MTProto/i);

const demoted = it.partyAdminDemoted("@alice");
assert.match(demoted, /membro/);

const kb = groupInviteKeyboard("https://t.me/+a", undefined, {
  counterpartLink: "https://t.me/+b",
});
const urls = kb.inline_keyboard.flat().map((b) => ("url" in b ? b.url : ""));
assert.ok(urls.includes("https://t.me/+a"));
assert.ok(urls.includes("https://t.me/+b"));

// groupCreatorReady is false without helper env in this smoke env
assert.equal(typeof groupCreatorReady(), "boolean");

console.log("check-bot-owned-groups: ok");
