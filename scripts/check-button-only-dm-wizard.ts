/**
 * Smoke: /crea pre-«aggiungi bot» role/asset use inline buttons;
 * free text is ignored (delete + re-prompt), not a flow advance;
 * main menu is inline (not reply KB); reply KB stripped for whole wizard.
 * npm exec tsx scripts/check-button-only-dm-wizard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assetKeyboard,
  MAIN_MENU_CREA_CB,
  MAIN_MENU_MIEI_CB,
  mainMenuKeyboard,
  removeReplyKeyboard,
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

// Main menu = inline in chat (not persistent ReplyKeyboard)
const menu = mainMenuKeyboard();
assert.equal(menu.inline_keyboard?.length, 1);
assert.equal(menu.inline_keyboard?.[0]?.length, 2);
assert.equal(menu.inline_keyboard?.[0]?.[0]?.callback_data, MAIN_MENU_CREA_CB);
assert.equal(menu.inline_keyboard?.[0]?.[1]?.callback_data, MAIN_MENU_MIEI_CB);
assert.match(
  menusSrc,
  /function mainMenuKeyboard\(\): InlineKeyboard \{\s*return new InlineKeyboard\(\)/,
);
assert.doesNotMatch(menusSrc, /mainMenuKeyboard[\s\S]{0,200}\.persistent\(\)/);

// Single callback wiring (no duplicate handler bodies)
assert.match(creaSrc, /callbackQuery\(MAIN_MENU_CREA_CB/);
assert.match(dealsSrc, /callbackQuery\(MAIN_MENU_MIEI_CB/);

// Strip reply KB for whole wizard; never restore reply menu
assert.deepEqual(removeReplyKeyboard().remove_keyboard, true);
assert.match(hygieneSrc, /stripPersistentReplyKeyboard/);
assert.match(hygieneSrc, /REPLY_KEYBOARD_STRIP_DELETE_MS/);
assert.match(hygieneSrc, /replyWithMainMenu/);
assert.doesNotMatch(hygieneSrc, /restoreMainMenuKeyboard/);
assert.doesNotMatch(creaSrc, /restoreMainMenuKeyboard/);
assert.match(creaSrc, /stripPersistentReplyKeyboard/);
assert.match(menusSrc, /remove_keyboard:\s*true/);

console.log("check-button-only-dm-wizard: OK");
