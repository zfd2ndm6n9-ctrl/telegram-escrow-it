/**
 * Smoke: copy outreach + admin `/outreach` wiring.
 * npm exec tsx scripts/check-outreach.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { outreachOpenBotKeyboard } from "../src/keyboards/menus.js";
import {
  OUTREACH_BOT_USERNAME,
  OUTREACH_BUTTON_LABEL,
  OUTREACH_ESCROW_BODY,
  OUTREACH_SELLER_BODY,
  OUTREACH_USAGE,
  outreachBody,
  outreachBotUrl,
  resolveOutreachAudience,
} from "../src/messages/outreach.js";

const root = resolve(import.meta.dirname, "..");
const startSrc = readFileSync(resolve(root, "src/handlers/start.ts"), "utf8");
const menusSrc = readFileSync(resolve(root, "src/keyboards/menus.ts"), "utf8");
const outreachSrc = readFileSync(
  resolve(root, "src/messages/outreach.ts"),
  "utf8",
);

assert.equal(OUTREACH_BOT_USERNAME, "ESCROWITAbot");
assert.equal(outreachBotUrl(), "https://t.me/ESCROWITAbot");
assert.equal(outreachBotUrl("@ESCROWITAbot"), "https://t.me/ESCROWITAbot");
assert.equal(OUTREACH_BUTTON_LABEL, "Apri @ESCROWITAbot");

assert.equal(resolveOutreachAudience("escrow"), "escrow");
assert.equal(resolveOutreachAudience("MM"), "escrow");
assert.equal(resolveOutreachAudience("seller"), "seller");
assert.equal(resolveOutreachAudience("community"), "seller");
assert.equal(resolveOutreachAudience("admins"), "seller");
assert.equal(resolveOutreachAudience(""), undefined);
assert.equal(resolveOutreachAudience("xyz"), undefined);

assert.equal(outreachBody("escrow"), OUTREACH_ESCROW_BODY);
assert.equal(outreachBody("seller"), OUTREACH_SELLER_BODY);

assert.match(OUTREACH_ESCROW_BODY, /@ESCROWITAbot/);
assert.match(OUTREACH_ESCROW_BODY, /codice invito/i);
assert.match(OUTREACH_ESCROW_BODY, /\*SOL\*/);
assert.doesNotMatch(OUTREACH_ESCROW_BODY, /\bLTC\b|\bETH\b/);

assert.match(OUTREACH_SELLER_BODY, /@ESCROWITAbot/);
assert.match(OUTREACH_SELLER_BODY, /24\/7/);
assert.match(OUTREACH_SELLER_BODY, /doppia conferma/i);
assert.match(OUTREACH_SELLER_BODY, /exit-scam/i);
assert.match(OUTREACH_SELLER_BODY, /5%/);
assert.match(OUTREACH_SELLER_BODY, /2\.5%/);
assert.match(OUTREACH_SELLER_BODY, /\*SOL\*/);
assert.doesNotMatch(OUTREACH_SELLER_BODY, /\bLTC\b|\bETH\b/);

assert.match(OUTREACH_USAGE, /\/outreach escrow/);
assert.match(OUTREACH_USAGE, /\/outreach seller/);

const kb = outreachOpenBotKeyboard(outreachBotUrl());
assert.equal(kb.inline_keyboard?.[0]?.[0]?.text, OUTREACH_BUTTON_LABEL);
assert.equal(
  kb.inline_keyboard?.[0]?.[0] && "url" in kb.inline_keyboard[0][0]
    ? kb.inline_keyboard[0][0].url
    : undefined,
  "https://t.me/ESCROWITAbot",
);

assert.match(menusSrc, /outreachOpenBotKeyboard/);
assert.match(outreachSrc, /OUTREACH_ESCROW_BODY/);
assert.match(outreachSrc, /OUTREACH_SELLER_BODY/);
assert.match(startSrc, /bot\.command\("outreach"/);
assert.match(startSrc, /resolveOutreachAudience/);
assert.match(startSrc, /outreachOpenBotKeyboard/);
assert.match(startSrc, /isAdminUser/);
assert.match(startSrc, /chat\?\.type !== "private"/);

console.log("check-outreach: ok");
