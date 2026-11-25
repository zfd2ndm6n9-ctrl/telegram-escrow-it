/**
 * Smoke: /crea pre-«aggiungi bot» role/asset use inline buttons;
 * free text is ignored (delete + re-prompt), not a flow advance.
 * npm exec tsx scripts/check-button-only-dm-wizard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetKeyboard, roleKeyboard } from "../src/keyboards/menus.js";

const root = resolve(import.meta.dirname, "..");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const menusSrc = readFileSync(
  resolve(root, "src/keyboards/menus.ts"),
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

console.log("check-button-only-dm-wizard: OK");
