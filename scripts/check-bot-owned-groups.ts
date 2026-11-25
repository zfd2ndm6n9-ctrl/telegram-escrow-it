/**
 * Smoke: bot-owned groups constants + demote helpers + copy (no Telegram).
 * npm exec tsx scripts/check-bot-owned-groups.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import {
  hasCounterpartInviteMessages,
  setupCardKeyboard,
} from "../src/services/group-setup.js";
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
// Dispute admin DMs on by default (unless DISPUTE_ADMIN_NOTIFY=0)
assert.equal(config.disputeAdminNotify, true);

{
  const root = resolve(import.meta.dirname, "..");
  const creatorSrc = readFileSync(
    resolve(root, "src/services/group-creator.ts"),
    "utf8",
  );
  assert.match(
    creatorSrc,
    /archiveHelperPeer/,
    "helper create archives escrow chat",
  );
  const helperSrc = readFileSync(
    resolve(root, "src/services/mtproto-helper.ts"),
    "utf8",
  );
  assert.match(
    helperSrc,
    /folders\.EditPeerFolders/,
    "archive uses MTProto folders.EditPeerFolders",
  );
  assert.match(helperSrc, /folderId:\s*1/, "archive folder_id = 1");
}

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
  true, // even if MTProto-invited: never «ti ho già aggiunto»
);
assert.match(ready, /Il tuo gruppo è stato creato/i);
assert.match(ready, /https:\/\/t\.me\/\+creator/);
assert.match(ready, /Entra nel gruppo e invita il \*seller\*/i);
assert.ok(!/ti ho già aggiunto/i.test(ready));
assert.ok(!/gestito da Escrowita/i.test(ready));
assert.ok(!/Nel gruppo trovi/i.test(ready));
assert.ok(!/indirizzo escrow/i.test(ready));
assert.ok(!/crea un \*gruppo privato\*/i.test(ready));
assert.ok(!/controparte/i.test(ready));

// Underscore in t.me/+ hash must be Markdown-escaped (else sendMessage fails).
const underscoreLink = "https://t.me/+Ab_Cd_Ef-Gh";
const readyEsc = it.groupReady(
  deal,
  { creatorLink: underscoreLink, counterpartLink: "https://t.me/+x" },
  false,
);
assert.match(readyEsc, /https:\/\/t\.me\/\+Ab\\_Cd\\_Ef-Gh/);
assert.ok(
  !readyEsc.includes(underscoreLink),
  "raw underscore link must not appear unescaped in Markdown body",
);

assert.equal(it.creatingGroup, "Sto creando il gruppo…");
assert.equal(it.invitaMissingParty("buyer"), "Invita il seller");
assert.equal(it.invitaMissingParty("seller"), "Invita il buyer");

// Helper awaiting card text = link only (message A); hint is separate (B).
const card = it.groupSetupCard(deal);
assert.equal(card, "https://t.me/+counterpart");
assert.ok(!/Entra come/i.test(card));
assert.ok(!/Invita il/i.test(card));
assert.ok(!/controparte/i.test(card));

const cardKb = setupCardKeyboard(deal);
assert.equal(
  cardKb.inline_keyboard.flat().length,
  0,
  "helper awaiting: no URL button on card (two plain messages)",
);

assert.equal(hasCounterpartInviteMessages(deal), false);
assert.equal(
  hasCounterpartInviteMessages({
    ...deal,
    counterpartInviteLinkMessageId: 10,
    counterpartInviteHintMessageId: 11,
  } as Deal),
  true,
);

const missing = it.groupCreateHelperMissing(deal);
assert.match(missing, /Bot API/i);
assert.match(missing, /HELPER_SESSION/);
assert.match(missing, /owner/i);

const fail = it.groupCreateFailed(deal, "boom");
assert.match(fail, /helper MTProto/i);

const demoted = it.partyAdminDemoted("@alice");
assert.match(demoted, /membro/);

const kb = groupInviteKeyboard("https://t.me/+a", "https://example.com/tos");
const flat = kb.inline_keyboard.flat();
assert.equal(flat.length, 1, "group-ready DM: solo ← Indietro");
const backBtn = flat[0];
assert.ok(backBtn && "text" in backBtn && "callback_data" in backBtn);
assert.equal(backBtn.text, "← Indietro");
assert.equal(backBtn.callback_data, "group_ready_back");
assert.ok(!("url" in backBtn), "no Entra nel gruppo URL button");
assert.ok(!("web_app" in backBtn), "no Leggi i Termini web_app button");
assert.ok(
  !flat.some((b) => "text" in b && /Entra nel gruppo|Leggi i Termini/i.test(b.text)),
  "no Entra / Leggi Termini labels",
);

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
