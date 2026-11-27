/**
 * Smoke: DM UX — Solo admin auto-delete; invite Annulla senza menu stack.
 * npm exec tsx scripts/check-dm-admin-invite-hygiene.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { invitePromptKeyboard } from "../src/keyboards/menus.js";
import { it } from "../src/messages/it.js";

const root = resolve(import.meta.dirname, "..");
const startSrc = readFileSync(resolve(root, "src/handlers/start.ts"), "utf8");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const groupSrc = readFileSync(
  resolve(root, "src/handlers/group-commands.ts"),
  "utf8",
);
const hygieneSrc = readFileSync(
  resolve(root, "src/services/dm-hygiene.ts"),
  "utf8",
);
const cleanupSrc = readFileSync(
  resolve(root, "src/services/prompt-cleanup.ts"),
  "utf8",
);

assert.equal(it.adminOnly, "Solo admin.");

// Admin denial: ephemeral helper + schedule cleanup (edit→delete fallback)
assert.match(hygieneSrc, /export async function replyAdminDenied/);
assert.match(hygieneSrc, /replyEphemeralNotice/);
assert.match(cleanupSrc, /export async function deleteMessageForce/);
assert.match(cleanupSrc, /export function scheduleMessageCleanup/);
assert.match(cleanupSrc, /editMessageText/);

// All Solo admin paths use replyAdminDenied (no sticky ctx.reply)
assert.doesNotMatch(startSrc, /ctx\.reply\(it\.adminOnly\)/);
assert.doesNotMatch(groupSrc, /ctx\.reply\(it\.adminOnly\)/);
assert.match(startSrc, /replyAdminDenied\(ctx\)/);
assert.match(groupSrc, /replyAdminDenied\(ctx\)/);
assert.match(creaSrc, /replyAdminDenied\(ctx,\s*it\.createGateAdminOnly/);

// Invite prompt: Annulla → crea_cancel (qualsiasi step creating, incl. invite)
const inviteKb = invitePromptKeyboard();
assert.equal(inviteKb.inline_keyboard?.[0]?.[0]?.callback_data, "crea_cancel");
{
  const cancelBlock = creaSrc.slice(
    creaSrc.indexOf('callbackQuery("crea_cancel"'),
    creaSrc.indexOf('callbackQuery("tos"'),
  );
  assert.match(cancelBlock, /cancelCreateWizard/);
  assert.doesNotMatch(cancelBlock, /step === "role"/);
}

// Cancel: cleanup leftover, no stacked main menu on cancel
assert.match(creaSrc, /cancelLeftoverCreaForNewFlow/);
assert.match(
  creaSrc,
  /async function cancelCreateWizard[\s\S]*?cancelLeftoverCreaForNewFlow/,
);
assert.doesNotMatch(
  creaSrc,
  /async function cancelCreateWizard[\s\S]*?replyWithMainMenu\(ctx,\s*it\.cancelled\)/,
);
assert.match(creaSrc, /replyEphemeralNotice\(ctx,\s*it\.cancelled\)/);
assert.match(creaSrc, /answerCallbackQuery\(\{\s*text:\s*"Annullato"/);

console.log("check-dm-admin-invite-hygiene: OK");
