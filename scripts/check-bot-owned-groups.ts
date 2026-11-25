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
import {
  entraComeMissingPartyLabel,
  groupInviteKeyboard,
  inviteMissingPartyKeyboard,
} from "../src/keyboards/menus.js";
import { setupCardKeyboard } from "../src/services/group-setup.js";
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
// Dispute admin DMs off unless DISPUTE_ADMIN_NOTIFY=1
assert.equal(config.disputeAdminNotify, false);

const deal = {
  id: "abcd1234",
  creatorId: 1,
  creatorRole: "buyer",
  buyerId: 1,
  sellerId: undefined,
  amount: "0.1",
  asset: "SOL",
  status: "awaiting_counterpart",
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  groupCreatedVia: "helper",
  counterpartInviteLink: "https://t.me/+counterpart",
  groupInviteLink: "https://t.me/+creator",
} as Deal;

const ready = it.groupReady(
  deal,
  {
    creatorLink: "https://t.me/+creator",
    counterpartLink: "https://t.me/+counterpart",
  },
  false,
);
assert.match(ready, /Il tuo gruppo è stato creato/i);
assert.match(ready, /https:\/\/t\.me\/\+creator/);
assert.ok(!/gestito da Escrowita/i.test(ready));
assert.ok(!/Nel gruppo trovi/i.test(ready));
assert.ok(!/Invita il/i.test(ready));
assert.ok(!/indirizzo escrow/i.test(ready));
assert.ok(!/crea un \*gruppo privato\*/i.test(ready));
assert.ok(!/controparte/i.test(ready));

const card = it.groupSetupCard(deal);
assert.match(card, /Entra come \*seller\*/i);
assert.match(card, /https:\/\/t\.me\/\+counterpart/);
assert.ok(!/Invita il/i.test(card));
assert.ok(!/entra o scrivi/i.test(card));
assert.ok(!/controparte/i.test(card));

const cardKb = setupCardKeyboard(deal);
assert.equal(
  cardKb.inline_keyboard.flat().length,
  0,
  "helper awaiting card: no Invita / URL button",
);

const missing = it.groupCreateHelperMissing(deal);
assert.match(missing, /Bot API/i);
assert.match(missing, /HELPER_SESSION/);
assert.match(missing, /owner/i);

const fail = it.groupCreateFailed(deal, "boom");
assert.match(fail, /helper MTProto/i);

const demoted = it.partyAdminDemoted("@alice");
assert.match(demoted, /membro/);

const kb = groupInviteKeyboard("https://t.me/+a", undefined);
const urls = kb.inline_keyboard.flat().map((b) => ("url" in b ? b.url : ""));
assert.ok(urls.includes("https://t.me/+a"));
const entraBtn = kb.inline_keyboard[0]?.[0];
assert.ok(entraBtn && "text" in entraBtn);
assert.match(entraBtn.text, /Entra nel gruppo/i);

assert.equal(entraComeMissingPartyLabel("seller"), "Entra come buyer");
assert.equal(entraComeMissingPartyLabel("buyer"), "Entra come seller");

const inviteKb = inviteMissingPartyKeyboard("seller", "https://t.me/+b");
const inviteBtn = inviteKb.inline_keyboard[0]?.[0];
assert.ok(inviteBtn && "text" in inviteBtn);
assert.equal(inviteBtn.text, "Entra come buyer");

// Manual fallback card still role-aware entra/scrivi (no «controparte»)
const manualDeal = {
  ...deal,
  groupCreatedVia: "manual" as const,
  counterpartInviteLink: undefined,
} as Deal;
const manualCard = it.groupSetupCard(manualDeal);
assert.match(manualCard, /Seller: entra o scrivi/i);
assert.ok(!/controparte/i.test(manualCard));

// groupCreatorReady is false without helper env in this smoke env
assert.equal(typeof groupCreatorReady(), "boolean");

console.log("check-bot-owned-groups: ok");
