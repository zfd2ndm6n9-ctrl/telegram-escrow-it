/**
 * Smoke: /crea pre-«aggiungi bot» role/asset use inline buttons;
 * free text is ignored (delete + re-prompt), not a flow advance;
 * main menu stays as persistent ReplyKeyboard (no strip/ghost).
 * npm exec tsx scripts/check-button-only-dm-wizard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assetKeyboard,
  MAIN_MENU_CREA_LABEL,
  MAIN_MENU_MIEI_LABEL,
  mainMenuKeyboard,
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

// Role + asset are InlineKeyboard (not ReplyKeyboard / oneTime)
const role = roleKeyboard();
const asset = assetKeyboard();
assert.equal(role.inline_keyboard?.length, 2);
assert.equal(asset.inline_keyboard?.length, 2);
assert.doesNotMatch(menusSrc, /roleKeyboard\(\)[\s\S]*?\.oneTime\(\)/);
assert.doesNotMatch(menusSrc, /assetKeyboard\(\)[\s\S]*?\.oneTime\(\)/);
assert.match(menusSrc, /crea_role:buyer/);
assert.match(menusSrc, /crea_asset:SOL/);
assert.match(menusSrc, /crea_cancel/);

// Callbacks registered
assert.match(creaSrc, /crea_role:\(buyer\|seller\)/);
assert.match(creaSrc, /crea_asset:\(SOL\|ETH\|LTC\)/);
assert.match(creaSrc, /callbackQuery\("crea_cancel"/);

// Free text mid role/asset → replaceCreatingPrompt (delete + re-send buttons)
assert.match(
  creaSrc,
  /creating\.step === "role"[\s\S]*?replaceCreatingPrompt[\s\S]*?roleKeyboard/,
);
assert.match(
  creaSrc,
  /creating\.step === "asset"[\s\S]*?replaceCreatingPrompt[\s\S]*?assetKeyboard/,
);

// Invite non-code free text → re-prompt (keep/re-send inline skip)
assert.match(creaSrc, /repromptInviteStep/);
assert.match(creaSrc, /Testo non-codice[\s\S]*repromptInviteStep/);

// Main menu = persistent ReplyKeyboard (Crea / I miei) — no strip/ghost
const menu = mainMenuKeyboard();
assert.equal(typeof (menu as { keyboard?: unknown }).keyboard, "object");
assert.match(
  menusSrc,
  /function mainMenuKeyboard\(\): Keyboard \{\s*return new Keyboard\(\)/,
);
assert.match(menusSrc, /MAIN_MENU_CREA_LABEL[\s\S]{0,80}MAIN_MENU_MIEI_LABEL[\s\S]{0,80}\.resized\(\)[\s\S]{0,40}\.persistent\(\)/);
assert.equal(MAIN_MENU_CREA_LABEL, "➕ Crea escrow");
assert.equal(MAIN_MENU_MIEI_LABEL, "📋 I miei deal");
assert.doesNotMatch(menusSrc, /menu:crea/);
assert.doesNotMatch(menusSrc, /remove_keyboard/);

// Reply-keyboard hears (primary), no inline menu callbacks
assert.match(creaSrc, /hears\(MAIN_MENU_CREA_LABEL/);
assert.match(dealsSrc, /hears\(MAIN_MENU_MIEI_LABEL/);
assert.doesNotMatch(creaSrc, /callbackQuery\(MAIN_MENU_CREA/);
assert.doesNotMatch(dealsSrc, /callbackQuery\(MAIN_MENU_MIEI/);

// No strip / ghost carrier — replyWithMainMenu attaches keyboard only
assert.doesNotMatch(hygieneSrc, /stripPersistentReplyKeyboard/);
assert.doesNotMatch(hygieneSrc, /\\u2060/);
assert.doesNotMatch(creaSrc, /stripPersistentReplyKeyboard/);
assert.doesNotMatch(dealsSrc, /stripPersistentReplyKeyboard/);
assert.match(hygieneSrc, /replyWithMainMenu/);
assert.doesNotMatch(hygieneSrc, /restoreMainMenuKeyboard/);
assert.doesNotMatch(creaSrc, /restoreMainMenuKeyboard/);

console.log("check-button-only-dm-wizard: OK");
