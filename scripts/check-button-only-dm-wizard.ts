/**
 * Smoke: /crea pre-group role uses inline buttons; free text is ignored
 * (delete + re-prompt); asset step removed (SOL only); main menu is inline.
 * npm exec tsx scripts/check-button-only-dm-wizard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GROUP_READY_BACK_CB,
  groupInviteKeyboard,
  MAIN_MENU_CREA_CB,
  MAIN_MENU_CREA_LABEL,
  MAIN_MENU_FEEDBACK_CB,
  MAIN_MENU_FEEDBACK_LABEL,
  MAIN_MENU_MIEI_CB,
  MAIN_MENU_MIEI_LABEL,
  MIEI_BACK_CB,
  mainMenuKeyboard,
  mieiBackKeyboard,
  roleKeyboard,
} from "../src/keyboards/menus.js";

const root = resolve(import.meta.dirname, "..");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const dealsSrc = readFileSync(resolve(root, "src/handlers/deals.ts"), "utf8");
const menusSrc = readFileSync(
  resolve(root, "src/keyboards/menus.ts"),
  "utf8",
);
const hygieneSrc = readFileSync(
  resolve(root, "src/services/dm-hygiene.ts"),
  "utf8",
);

// Role is InlineKeyboard (not ReplyKeyboard / oneTime); no asset picker
const role = roleKeyboard();
assert.equal(role.inline_keyboard?.length, 2);
assert.doesNotMatch(menusSrc, /roleKeyboard\(\)[\s\S]*?\.oneTime\(\)/);
assert.match(menusSrc, /crea_role:buyer/);
assert.match(menusSrc, /crea_cancel/);
assert.doesNotMatch(menusSrc, /crea_asset:/);
assert.doesNotMatch(menusSrc, /Ł LTC/);
assert.doesNotMatch(menusSrc, /Ξ ETH/);
assert.doesNotMatch(menusSrc, /assetKeyboard/);
assert.doesNotMatch(creaSrc, /crea_asset:/);
assert.doesNotMatch(creaSrc, /step === "asset"/);
assert.doesNotMatch(creaSrc, /"LTC"/);
assert.doesNotMatch(creaSrc, /"ETH"/);

// Callbacks registered
assert.match(creaSrc, /crea_role:\(buyer\|seller\)/);
assert.match(creaSrc, /callbackQuery\("crea_cancel"/);
assert.match(creaSrc, /asset: "SOL"/);

// Free text mid role → replaceCreatingPrompt (delete + re-send buttons)
assert.match(
  creaSrc,
  /creating\.step === "role"[\s\S]*?replaceCreatingPrompt[\s\S]*?roleKeyboard/,
);

// Invite non-code free text → re-prompt (keep/re-send inline skip)
assert.match(creaSrc, /repromptInviteStep/);
assert.match(creaSrc, /Testo non-codice[\s\S]*repromptInviteStep/);

// Main menu = inline in chat (not persistent ReplyKeyboard)
// Row 1: Crea / I miei · Row 2: Feedback
const menu = mainMenuKeyboard();
assert.equal(menu.inline_keyboard?.length, 2);
assert.equal(menu.inline_keyboard?.[0]?.length, 2);
assert.equal(menu.inline_keyboard?.[1]?.length, 1);
assert.equal(menu.inline_keyboard?.[0]?.[0]?.callback_data, MAIN_MENU_CREA_CB);
assert.equal(menu.inline_keyboard?.[0]?.[1]?.callback_data, MAIN_MENU_MIEI_CB);
assert.equal(
  menu.inline_keyboard?.[1]?.[0]?.callback_data,
  MAIN_MENU_FEEDBACK_CB,
);
assert.equal(MAIN_MENU_CREA_LABEL, "➕ Crea escrow");
assert.equal(MAIN_MENU_MIEI_LABEL, "📋 I miei deal");
assert.equal(MAIN_MENU_FEEDBACK_LABEL, "💬 Lascia un feedback");
assert.match(
  menusSrc,
  /function mainMenuKeyboard\(\): InlineKeyboard \{\s*return new InlineKeyboard\(\)/,
);
assert.doesNotMatch(menusSrc, /mainMenuKeyboard[\s\S]{0,200}\.persistent\(\)/);
assert.doesNotMatch(menusSrc, /mainMenuKeyboard[\s\S]{0,120}new Keyboard\(/);

// Single callback wiring (no duplicate handler bodies)
assert.match(creaSrc, /callbackQuery\(MAIN_MENU_CREA_CB/);
assert.match(dealsSrc, /callbackQuery\(MAIN_MENU_MIEI_CB/);
assert.match(dealsSrc, /callbackQuery\(MIEI_BACK_CB/);
assert.match(creaSrc, /hears\(MAIN_MENU_CREA_LABEL/);
assert.match(dealsSrc, /hears\(MAIN_MENU_MIEI_LABEL/);

// /miei list: ← Indietro only (no repeating Crea / I miei)
const mieiBack = mieiBackKeyboard();
assert.equal(mieiBack.inline_keyboard?.[0]?.[0]?.callback_data, MIEI_BACK_CB);
assert.equal(mieiBack.inline_keyboard?.[0]?.[0]?.text, "← Indietro");
assert.match(dealsSrc, /mieiBackKeyboard\(\)/);
assert.doesNotMatch(
  dealsSrc,
  /listDeals[\s\S]{0,800}reply_markup:\s*mainMenuKeyboard\(\)/,
);

// After wizard: ephemeral «Sto creando…» + resilient creator invite DM
assert.match(creaSrc, /it\.creatingGroup/);
assert.match(creaSrc, /creatingMsgId/);
assert.match(creaSrc, /replyCreatorInviteDm/);
assert.match(creaSrc, /postHelperCounterpartInvite/);
assert.match(creaSrc, /finally/);

// Group-ready DM: ← Indietro only (no Entra / Leggi Termini buttons)
const readyKb = groupInviteKeyboard("https://t.me/+x", "https://example.com/tos");
assert.equal(readyKb.inline_keyboard?.flat().length, 1);
assert.equal(readyKb.inline_keyboard?.[0]?.[0]?.text, "← Indietro");
assert.equal(
  readyKb.inline_keyboard?.[0]?.[0]?.callback_data,
  GROUP_READY_BACK_CB,
);
assert.match(creaSrc, /GROUP_READY_BACK_CB/);
assert.match(creaSrc, /editMessageReplyMarkup/);
{
  const m = menusSrc.match(
    /export function groupInviteKeyboard\([\s\S]*?\n\}/,
  );
  assert.ok(m, "groupInviteKeyboard body");
  const body = m[0];
  assert.match(body, /← Indietro/);
  assert.match(body, /GROUP_READY_BACK_CB/);
  assert.doesNotMatch(body, /Entra nel gruppo/);
  assert.doesNotMatch(body, /Leggi i Termini/);
  assert.doesNotMatch(body, /\.url\(/);
  assert.doesNotMatch(body, /\.webApp\(/);
}

// No strip / ghost carrier — replyWithMainMenu attaches inline only
assert.doesNotMatch(hygieneSrc, /stripPersistentReplyKeyboard/);
assert.doesNotMatch(hygieneSrc, /\\u2060/);
assert.doesNotMatch(creaSrc, /stripPersistentReplyKeyboard/);
assert.doesNotMatch(dealsSrc, /stripPersistentReplyKeyboard/);
assert.doesNotMatch(menusSrc, /remove_keyboard/);
assert.match(hygieneSrc, /replyWithMainMenu/);
assert.match(hygieneSrc, /reply_markup:\s*mainMenuKeyboard\(\)/);
assert.doesNotMatch(hygieneSrc, /restoreMainMenuKeyboard/);
assert.doesNotMatch(creaSrc, /restoreMainMenuKeyboard/);

console.log("check-button-only-dm-wizard: OK");
