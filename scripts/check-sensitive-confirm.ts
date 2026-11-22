/**
 * Smoke statico: tastiere dual-confirm + disputa (senza Telegram).
 * npm exec tsx scripts/check-sensitive-confirm.ts
 */
import assert from "node:assert/strict";
import {
  altreInfoKeyboard,
  buyerAfterShipKeyboard,
  groupActionsKeyboard,
  refundConfirmKeyboard,
  selfConfirmKeyboard,
  sellerConfirmPayKeyboard,
  shipAskKeyboard,
} from "../src/keyboards/menus.js";
import { formatDealStatus, it } from "../src/messages/it.js";
import type { Deal } from "../src/types.js";

function callbacksOf(kb: { inline_keyboard: { text: string; callback_data?: string }[][] }): string[] {
  return kb.inline_keyboard.flat().map((b) => b.callback_data ?? "");
}

function labelsOf(kb: { inline_keyboard: { text: string }[][] }): string[] {
  return kb.inline_keyboard.flat().map((b) => b.text);
}

const baseDeal = {
  id: "deadbeef",
  creatorId: 1,
  creatorRole: "buyer" as const,
  buyerId: 10,
  buyerUsername: "buyer_x",
  sellerId: 20,
  sellerUsername: "seller_y",
  amount: "0.1",
  asset: "SOL" as const,
  status: "funded" as const,
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [] as number[],
  refundVotes: [] as number[],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies Deal;

// Sì + ← Indietro (niente No)
{
  const labels = labelsOf(selfConfirmKeyboard());
  assert.deepEqual(labels, ["Sì", "← Indietro"]);
  assert.deepEqual(callbacksOf(selfConfirmKeyboard()), ["sc_yes", "sc_back"]);
}

// Buyer after ship: Disputa + Altre info sulla CTA primaria
{
  const cbs = callbacksOf(buyerAfterShipKeyboard(baseDeal));
  assert.ok(cbs.includes("buyer_pay"));
  assert.ok(cbs.includes("refund_buyer"));
  assert.ok(cbs.includes("buyer_info"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(!cbs.includes("buyer_dispute"));
}

// Altre info: Disputa non più nested (è sulla tastiera principale)
{
  assert.deepEqual(callbacksOf(altreInfoKeyboard()), []);
}

// awaiting_deposit: Verifica + Disputa + Altre info + Stato; niente Indirizzo escrow
{
  const cbs = callbacksOf(groupActionsKeyboard("awaiting_deposit", baseDeal));
  assert.ok(cbs.includes("funded"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(cbs.includes("altre_info"));
  assert.ok(cbs.includes("stato"));
  assert.ok(!cbs.includes("addr"));
  assert.ok(!cbs.includes("refund_buyer"));
  const labels = labelsOf(groupActionsKeyboard("awaiting_deposit", baseDeal));
  assert.ok(labels.includes("💰 Verifica deposito"));
  assert.ok(labels.includes("⚠️ Disputa"));
  assert.ok(labels.includes("ℹ️ Altre info"));
  assert.ok(labels.includes("📄 Stato"));
  assert.ok(!labels.includes("📫 Indirizzo escrow"));
}

// disputed: stato + annulla — niente addr/paga/rimborsa/verifica/consegnato
{
  const cbs = callbacksOf(groupActionsKeyboard("disputed", baseDeal));
  assert.deepEqual(cbs.sort(), ["dispute_cancel", "stato"].sort());
  assert.ok(!cbs.includes("addr"));
  assert.ok(!cbs.includes("funded"));
  assert.ok(!cbs.includes("buyer_pay"));
  assert.ok(!cbs.includes("refund_buyer"));
  assert.ok(!cbs.includes("shipped"));
}

// funded ship ask: rimborsa + disputa
{
  const cbs = callbacksOf(shipAskKeyboard());
  assert.ok(cbs.includes("shipped"));
  assert.ok(cbs.includes("refund_buyer"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(cbs.includes("altre_info"));
}

// Mentions: wallet prompt senza label Seller/Buyer prima della @
{
  const sellerAsk = it.askSellerWallet(baseDeal);
  const buyerAsk = it.askBuyerWallet(baseDeal);
  assert.match(sellerAsk, /@seller\\_y/);
  assert.match(buyerAsk, /@buyer\\_x/);
  assert.ok(!/\*Seller\*/.test(sellerAsk));
  assert.ok(!/\*Buyer\*/.test(buyerAsk));
  // Eccezione: notifica sull'altra parte tiene la parola seller/buyer
  assert.match(it.buyerAfterShip(baseDeal), /seller ha consegnato/i);
}

// Stato: corto, senza indirizzo / Invito / «Escrow:»
{
  const status = formatDealStatus({
    ...baseDeal,
    status: "awaiting_deposit",
    inviteCode: "KEYTEST",
  });
  assert.match(status, /#deadbeef/);
  assert.match(status, /Importo/);
  assert.match(status, /@buyer_x/);
  assert.match(status, /@seller_y/); // plain text in status (no md escape)
  assert.ok(!status.includes(baseDeal.escrowAddress));
  assert.ok(!/Escrow:/.test(status));
  assert.ok(!/Invito:/.test(status));
  assert.ok(!/Buyer @/.test(status));
  assert.ok(!/Seller @/.test(status));
}

// Copy conferma
{
  const ask = it.selfConfirmAsk(baseDeal, "dispute_open", 10);
  assert.match(ask, /@buyer/);
  assert.match(ask.toLowerCase(), /disputa/);
  assert.equal(it.frozenInDispute, "In disputa.");
  assert.equal(it.wrongStatus("disputed"), "In disputa.");
}

// Dual-confirm 1/2: Confermo + Annulla (pay e refund)
{
  assert.deepEqual(labelsOf(sellerConfirmPayKeyboard()), ["✅ Confermo", "Annulla"]);
  assert.deepEqual(callbacksOf(sellerConfirmPayKeyboard()), [
    "seller_confirm_pay",
    "cancel_confirm_pay",
  ]);
  assert.deepEqual(labelsOf(refundConfirmKeyboard()), ["✅ Confermo", "Annulla"]);
  assert.deepEqual(callbacksOf(refundConfirmKeyboard()), [
    "confirm_refund",
    "cancel_confirm_refund",
  ]);
  const cancelPay = it.dualConfirmCancelled(baseDeal, "release");
  assert.match(cancelPay, /annullata/i);
  assert.match(cancelPay, /aperto/i);
  const cancelRefund = it.dualConfirmCancelled(baseDeal, "refund");
  assert.match(cancelRefund, /annullata/i);
  assert.match(cancelRefund, /aperto/i);
}

console.log("check-sensitive-confirm: ok");
