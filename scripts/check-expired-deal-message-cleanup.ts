/**
 * Smoke: group-bind expiry notice deleted on next /crea.
 * npm exec tsx scripts/check-expired-deal-message-cleanup.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const typesSrc = readFileSync(resolve(root, "src/types.ts"), "utf8");
const expirySrc = readFileSync(
  resolve(root, "src/services/group-bind-expiry.ts"),
  "utf8",
);
const hygieneSrc = readFileSync(
  resolve(root, "src/services/dm-hygiene.ts"),
  "utf8",
);
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);

// Deal tracks scaduto notice message id
assert.match(typesSrc, /dmGroupBindExpiredMessageId\?: number/);

// Expiry watcher persists notice message_id after send
assert.match(expirySrc, /dmGroupBindExpiredMessageId:\s*notice\.message_id/);
assert.match(expirySrc, /groupBindExpired/);

// /crea leftover cancel clears prior scaduto notices
assert.match(hygieneSrc, /export async function clearExpiredGroupBindNotices/);
assert.match(hygieneSrc, /dmGroupBindExpiredMessageId/);
assert.match(
  hygieneSrc,
  /cancelLeftoverCreaForNewFlow[\s\S]*clearExpiredGroupBindNotices/,
);

// beginCreateDealFlow still goes through leftover cancel
assert.match(creaSrc, /cancelLeftoverCreaForNewFlow/);

console.log("check-expired-deal-message-cleanup: OK");
