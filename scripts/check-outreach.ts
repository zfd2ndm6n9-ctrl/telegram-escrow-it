/**
 * Smoke: copy outreach + admin `/outreach` wiring + Apri bot URL button.
 * npm exec tsx scripts/check-outreach.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openBotDmKeyboard } from "../src/keyboards/menus.js";
import {
  OUTREACH_BOT_USERNAME,
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

assert.equal(resolveOutreachAudience("escrow"), "escrow");
assert.equal(resolveOutreachAudience("MM"), "escrow");
assert.equal(resolveOutreachAudience("seller"), "seller");
assert.equal(resolveOutreachAudience("community"), "seller");
assert.equal(resolveOutreachAudience("admins"), "seller");
assert.equal(resolveOutreachAudience(""), undefined);
assert.equal(resolveOutreachAudience("xyz"), undefined);

assert.equal(outreachBody("escrow"), OUTREACH_ESCROW_BODY);
assert.equal(outreachBody("seller"), OUTREACH_SELLER_BODY);
assert.equal(
  outreachBody("escrow", "OtherBot"),
  OUTREACH_ESCROW_BODY.replaceAll(
    "https://t.me/ESCROWITAbot",
    "https://t.me/OtherBot",
  ),
);

assert.match(OUTREACH_ESCROW_BODY, /Ciao, siamo \*Escrowita\*/);
assert.match(OUTREACH_ESCROW_BODY, /@ESCROWITAbot/);
assert.match(OUTREACH_ESCROW_BODY, /codice invito/i);
assert.match(OUTREACH_ESCROW_BODY, /https:\/\/t\.me\/ESCROWITAbot/);
assert.doesNotMatch(OUTREACH_ESCROW_BODY, /\bSOL\b|\bLTC\b|\bETH\b/);
assert.doesNotMatch(OUTREACH_ESCROW_BODY, /escrow automatico/i);

assert.match(OUTREACH_SELLER_BODY, /Ciao, siamo \*Escrowita\*/);
assert.match(OUTREACH_SELLER_BODY, /@ESCROWITAbot/);
assert.match(OUTREACH_SELLER_BODY, /24\/7/);
assert.match(OUTREACH_SELLER_BODY, /doppia conferma/i);
assert.match(OUTREACH_SELLER_BODY, /chiave e indirizzo/i);
assert.match(OUTREACH_SELLER_BODY, /codice invito/i);
assert.match(OUTREACH_SELLER_BODY, /5%/);
assert.match(OUTREACH_SELLER_BODY, /2\.5%/);
assert.match(OUTREACH_SELLER_BODY, /https:\/\/t\.me\/ESCROWITAbot/);
assert.doesNotMatch(OUTREACH_SELLER_BODY, /exit-scam/i);
assert.doesNotMatch(OUTREACH_SELLER_BODY, /\bSOL\b|\bLTC\b|\bETH\b/);
assert.doesNotMatch(OUTREACH_SELLER_BODY, /escrow automatico/i);

assert.match(OUTREACH_USAGE, /\/outreach escrow/);
assert.match(OUTREACH_USAGE, /\/outreach seller/);
assert.match(OUTREACH_USAGE, /Apri bot/);
assert.match(OUTREACH_USAGE, /Inoltra/i);

const kb = openBotDmKeyboard(outreachBotUrl());
const btn = kb.inline_keyboard?.[0]?.[0];
assert.ok(btn && "text" in btn);
assert.equal(btn.text, "Apri bot");
assert.equal("url" in btn ? btn.url : undefined, "https://t.me/ESCROWITAbot");

assert.match(menusSrc, /openBotDmKeyboard/);
assert.match(menusSrc, /"Apri bot"/);
assert.doesNotMatch(menusSrc, /outreachOpenBotKeyboard/);
assert.match(outreachSrc, /OUTREACH_ESCROW_BODY/);
assert.match(outreachSrc, /OUTREACH_SELLER_BODY/);
assert.match(startSrc, /bot\.command\("outreach"/);
assert.match(startSrc, /resolveOutreachAudience/);
assert.match(startSrc, /isAdminUser/);
assert.match(startSrc, /chat\?\.type !== "private"/);
assert.match(startSrc, /openBotDmKeyboard/);
assert.match(startSrc, /outreachBotUrl/);
assert.match(startSrc, /reply_markup:\s*openBotDmKeyboard/);

console.log("check-outreach: ok");
