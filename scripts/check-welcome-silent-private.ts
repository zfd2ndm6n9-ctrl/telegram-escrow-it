/**
 * Smoke: welcome senza elenco /crea /miei; free text idle → delete, no reply.
 * npm exec tsx scripts/check-welcome-silent-private.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "../src/messages/it.js";

const root = resolve(import.meta.dirname, "..");
const botSrc = readFileSync(resolve(root, "src/bot.ts"), "utf8");
const itSrc = readFileSync(resolve(root, "src/messages/it.ts"), "utf8");

const welcome = it.registeredOk("demo_user");
const back = it.welcomeBack("demo_user");

assert.doesNotMatch(welcome, /\/crea\s*—/);
assert.doesNotMatch(welcome, /\/miei\s*—/);
assert.doesNotMatch(back, /\/crea\s*—/);
assert.doesNotMatch(back, /\/miei\s*—/);
assert.match(welcome, /Escrowita|Escrow sicuro|servizi digitali/);
assert.match(back, /Bentornato|Escrowita/);

// Catch-all: delete, never reply unknownPrivate
assert.match(botSrc, /deleteMessageSafe/);
assert.doesNotMatch(botSrc, /unknownPrivate/);
assert.doesNotMatch(
  botSrc,
  /bot\.on\("message:text"[\s\S]*?ctx\.reply\(it\.unknownPrivate\)/,
);

// Copy still defines deprecated string for compat; unused by bot catch-all
assert.match(itSrc, /unknownPrivate:/);
assert.match(it.askInviteOptional, /🔑|Codice invito/);
assert.match(it.askRole, /👤|ruolo/);
assert.doesNotMatch(itSrc, /askAsset:/);

console.log("check-welcome-silent-private: OK");
