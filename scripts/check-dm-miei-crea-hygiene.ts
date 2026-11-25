/**
 * Smoke: DM /miei ↔ /crea single-message hygiene.
 * npm exec tsx scripts/check-dm-miei-crea-hygiene.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dealsSrc = readFileSync(resolve(root, "src/handlers/deals.ts"), "utf8");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const hygieneSrc = readFileSync(
  resolve(root, "src/services/dm-hygiene.ts"),
  "utf8",
);
const expirySrc = readFileSync(
  resolve(root, "src/services/group-bind-expiry.ts"),
  "utf8",
);
const ctxSrc = readFileSync(resolve(root, "src/context.ts"), "utf8");

// /miei: edit-in-place (no delete+repost-only regression)
assert.match(dealsSrc, /editMessageText/);
assert.match(dealsSrc, /cancelMidCreaBeforeGroupBind/);
assert.match(dealsSrc, /mieiListMessageId/);
assert.doesNotMatch(
  dealsSrc,
  /if \(prevBotId != null\) \{\s*await deleteMessageSafe/,
);

// /crea: full leftover cancel (miei + unbound drafts + terms)
assert.match(creaSrc, /cancelLeftoverCreaForNewFlow/);
assert.match(hygieneSrc, /export async function cancelLeftoverCreaForNewFlow/);
assert.match(hygieneSrc, /clearDmTermsUi/);
assert.match(hygieneSrc, /dmGroupInstructionsMessageId/);

// Menu bypass so «I miei deal» reaches deals hears mid-wizard
assert.match(creaSrc, /MAIN_MENU_TEXTS/);
assert.match(creaSrc, /MAIN_MENU_MIEI_LABEL/);
assert.match(creaSrc, /await next\(\)/);

// pickRole no-op unless on role step
assert.match(creaSrc, /prev\.step !== "role"\) return/);

// Orphan terms resume guard
assert.match(
  creaSrc,
  /creating && !ctx\.session\.termsQa\) return false/,
);

// Annulla reuses leftover cancel (clears termsErrorMessageIds too)
assert.match(creaSrc, /❌ Annulla[\s\S]*cancelLeftoverCreaForNewFlow/);
assert.match(hygieneSrc, /clearTermsErrorMessages/);

// Expiry clears terms UI, not only group instructions
assert.match(expirySrc, /clearDmTermsUi/);

// Expiry tracks scaduto notice; /crea leftover cancel deletes it
assert.match(expirySrc, /dmGroupBindExpiredMessageId/);
assert.match(hygieneSrc, /clearExpiredGroupBindNotices/);

// Session comment matches edit behavior
assert.match(ctxSrc, /edit-in-place/);

console.log("check-dm-miei-crea-hygiene: OK");
