/**
 * Smoke: invite su /crea (non /start), soft nudge DM, group redirect.
 * npm exec tsx scripts/check-crea-invite-hygiene.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "../src/messages/it.js";

const root = resolve(import.meta.dirname, "..");
const startSrc = readFileSync(resolve(root, "src/handlers/start.ts"), "utf8");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);

// Soft nudge in DM — mai «apri una chat privata» quando già in privato
assert.equal(it.needRegistration, "Prima `/start` qui.");
assert.doesNotMatch(it.needRegistration, /apri una chat/i);

// Group /crea redirect
assert.match(it.creaInGroup, /privata/i);
assert.match(it.creaInGroup, /\/crea/);

// /start non chiede invito
assert.doesNotMatch(startSrc, /askInviteOptional\(/);
assert.match(startSrc, /pendingCrea/);
assert.match(startSrc, /beginCreateDealFlow/);

// /crea chiede invito + skip silenzioso
assert.match(creaSrc, /askInviteOptional\(/);
assert.match(creaSrc, /completeInviteSkip/);
assert.match(creaSrc, /proceedToRoleStep/);
assert.match(creaSrc, /creaInGroup/);
assert.match(creaSrc, /openBotDmKeyboard/);
assert.match(creaSrc, /start=crea/);

// Step invite sul creating session
assert.match(creaSrc, /step: "invite"/);

console.log("check-crea-invite-hygiene: OK");
