/**
 * Smoke: invite su /crea (non /start), soft nudge DM, group redirect.
 * npm exec tsx scripts/check-crea-invite-hygiene.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "../src/messages/it.js";
import type { Deal } from "../src/types.js";

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

// /crea chiede invito (skip solo legacy callback/comando; no CTA keyboard)
assert.match(creaSrc, /askInviteOptional\(/);
assert.match(creaSrc, /completeInviteSkip/);
assert.match(creaSrc, /proceedToRoleStep/);
assert.match(creaSrc, /creaInGroup/);
assert.match(creaSrc, /openBotDmKeyboard/);
assert.match(creaSrc, /start=crea/);
assert.match(creaSrc, /step !== "invite"/); // crea_cancel anche su invite

{
  const menusSrc = readFileSync(resolve(root, "src/keyboards/menus.ts"), "utf8");
  const inviteSrc = readFileSync(
    resolve(root, "src/services/invite-step.ts"),
    "utf8",
  );
  assert.match(menusSrc, /invitePromptKeyboard/);
  assert.match(menusSrc, /crea_cancel/);
  assert.doesNotMatch(menusSrc, /\.text\("Nessun codice"/);
  assert.doesNotMatch(menusSrc, /"invite_skip"/);
  assert.match(inviteSrc, /invitePromptKeyboard\(/);
  assert.doesNotMatch(inviteSrc, /inviteSkipKeyboard/);
  assert.doesNotMatch(it.askInviteOptional, /Nessun codice/i);
  assert.doesNotMatch(it.createGateInviteAsk, /opzionale|tocca/i);
}

// Step invite sul creating session
assert.match(creaSrc, /step: "invite"/);

// Apply codice: silenzioso in DM (niente inviteRedeemOk reply)
assert.doesNotMatch(creaSrc, /inviteRedeemOk\(/);
assert.match(creaSrc, /Silenzioso in DM/);

// /invito success anche silenzioso (niente ack «applicato» in DM)
assert.doesNotMatch(startSrc, /inviteRedeemOk\(/);
assert.doesNotMatch(startSrc, /inviteRedeemAlready\(/);

// Card pinnata: Seller/Buyer + Invito; non side-by-side @ · @
{
  const deal = {
    id: "abcd1234",
    creatorId: 1,
    creatorRole: "seller" as const,
    buyerId: 10,
    buyerUsername: "buyer_x",
    sellerId: 20,
    sellerUsername: "seller_y",
    asset: "SOL" as const,
    status: "awaiting_tos" as const,
    escrowAddress: "Escrow1111111111111111111111111111111111111",
    releaseVotes: [] as number[],
    refundVotes: [] as number[],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    inviteCode: "KEYTEST",
    tosProduct: "x",
    priceEur: "1",
    tosConditions: "y",
  } satisfies Deal;
  const card = it.groupSetupCard(deal);
  assert.match(card, /• Seller: @seller\\_y/);
  assert.match(card, /• Buyer: @buyer\\_x/);
  assert.match(card, /• Invito: \*KEYTEST\*/);
  assert.ok(!/@buyer\\_x · @seller\\_y/.test(card));
  assert.ok(!/@seller\\_y · @buyer\\_x/.test(card));
}

console.log("check-crea-invite-hygiene: OK");
