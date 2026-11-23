/**
 * Smoke statico: tastiere dual-confirm + disputa + Stato/fee/role gates (senza Telegram).
 * npm exec tsx scripts/check-sensitive-confirm.ts
 */
import assert from "node:assert/strict";
import {
  altreInfoKeyboard,
  buyerAfterShipKeyboard,
  disputeAdminFallbackKeyboard,
  groupActionsKeyboard,
  refundConfirmKeyboard,
  selfConfirmKeyboard,
  sellerConfirmPayKeyboard,
  shipAskKeyboard,
  uiBackKeyboard,
} from "../src/keyboards/menus.js";
import { formatDealStatus, it } from "../src/messages/it.js";
import {
  canCancelDualConfirm,
  canConfirmPendingVote,
  canConfirmRefund,
  canConfirmSellerPay,
  canMarkShipped,
  canSetWalletNow,
  canStartBuyerPay,
  canStartRefund,
  pendingVoterId,
} from "../src/services/deal-logic.js";
import type { Deal } from "../src/types.js";

function callbacksOf(kb: {
  inline_keyboard: { text: string; callback_data?: string }[][];
}): string[] {
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

// Schermate click: ← Indietro → ui_back
{
  assert.deepEqual(labelsOf(uiBackKeyboard()), ["← Indietro"]);
  assert.deepEqual(callbacksOf(uiBackKeyboard()), ["ui_back"]);
  assert.deepEqual(callbacksOf(altreInfoKeyboard()), ["ui_back"]);
}

// Buyer after ship: Paga / rimborso / Disputa / Altre info (altre_info = stato+fee)
{
  const cbs = callbacksOf(buyerAfterShipKeyboard(baseDeal));
  assert.ok(cbs.includes("buyer_pay"));
  assert.ok(cbs.includes("refund_buyer"));
  assert.ok(cbs.includes("altre_info"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(!cbs.includes("buyer_info"), "buyer_info legacy; UI usa altre_info");
  assert.ok(!cbs.includes("buyer_dispute"));
  assert.ok(!cbs.includes("stato"), "post-consegna: Stato in Altre info");
}

// awaiting_deposit: Disputa + Altre info + Stato; niente Verifica / Indirizzo
{
  const cbs = callbacksOf(groupActionsKeyboard("awaiting_deposit", baseDeal));
  assert.ok(!cbs.includes("funded"), "Verifica deposito standalone rimossa");
  assert.ok(cbs.includes("dispute"));
  assert.ok(cbs.includes("altre_info"));
  assert.ok(cbs.includes("stato"));
  assert.ok(!cbs.includes("addr"));
  assert.ok(!cbs.includes("refund_buyer"));
  const labels = labelsOf(groupActionsKeyboard("awaiting_deposit", baseDeal));
  assert.ok(!labels.includes("💰 Verifica deposito"));
  assert.ok(labels.includes("⚠️ Disputa"));
  assert.ok(labels.includes("ℹ️ Altre info"));
  assert.ok(labels.includes("📄 Stato"));
  assert.ok(!labels.includes("📫 Indirizzo escrow"));
}

// funded: rimborso + Altre info; niente Stato standalone (contenuto in Altre info)
{
  const cbs = callbacksOf(groupActionsKeyboard("funded", baseDeal));
  assert.ok(cbs.includes("refund_buyer"));
  assert.ok(cbs.includes("altre_info"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(!cbs.includes("stato"), "post-deposito: Stato assorbito in Altre info");
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

// funded ship ask: rimborso azione + disputa (niente «Rimborsa buyer»)
{
  const cbs = callbacksOf(shipAskKeyboard());
  const labels = labelsOf(shipAskKeyboard());
  assert.ok(cbs.includes("shipped"));
  assert.ok(cbs.includes("refund_buyer"));
  assert.ok(cbs.includes("dispute"));
  assert.ok(cbs.includes("altre_info"));
  assert.ok(labels.includes("↩️ Chiedi il rimborso"));
  assert.ok(!labels.some((l) => /Rimborsa buyer/i.test(l)));
}

// Role-aware CTA: Paga / Chiedi il rimborso (non «Paga @seller»)
{
  const labels = labelsOf(buyerAfterShipKeyboard(baseDeal));
  assert.ok(labels.includes("🔓 Paga"));
  assert.ok(labels.includes("↩️ Chiedi il rimborso"));
  assert.ok(!labels.some((l) => /Paga @/i.test(l)));
  assert.ok(!labels.some((l) => /Rimborsa buyer/i.test(l)));
  const fundedLabels = labelsOf(groupActionsKeyboard("funded", baseDeal));
  assert.ok(fundedLabels.includes("↩️ Chiedi il rimborso"));
  assert.ok(!fundedLabels.some((l) => /Rimborsa buyer/i.test(l)));
}

// Mentions: wallet prompt senza label Seller/Buyer prima della @
{
  const sellerAsk = it.askSellerWallet(baseDeal);
  const buyerAsk = it.askBuyerWallet(baseDeal);
  assert.match(sellerAsk, /@seller\\_y/);
  assert.match(buyerAsk, /@buyer\\_x/);
  assert.ok(!/\*Seller\*/.test(sellerAsk));
  assert.ok(!/\*Buyer\*/.test(buyerAsk));
  // Parla al buyer della consegna seller + CTA azione
  assert.match(it.buyerAfterShip(baseDeal), /seller ha consegnato/i);
  assert.match(it.buyerAfterShip(baseDeal), /Chiedi il rimborso/i);
}

// Stato: Seller/Buyer bullets; niente fee / indirizzo / Invito
{
  const status = formatDealStatus({
    ...baseDeal,
    status: "awaiting_deposit",
    inviteCode: "KEYTEST",
  });
  assert.match(status, /#deadbeef/);
  assert.match(status, /Importo/);
  assert.match(status, /• Seller: @seller_y/);
  assert.match(status, /• Buyer: @buyer_x/);
  assert.ok(!/@buyer_x · @seller_y/.test(status));
  assert.ok(!/@seller_y · @buyer_x/.test(status));
  assert.ok(!status.includes(baseDeal.escrowAddress));
  assert.ok(!/Escrow:/.test(status));
  assert.ok(!/Invito:/.test(status));
  assert.ok(!/Fee:/i.test(status), "fee solo in Altre info");
}

// Stato + riga deposito: In attesa (0) → Rilevato → Confermato
{
  assert.match(
    it.depositStatusBullets("0", "0.1", false),
    /• Deposito: \*In attesa\* — \*0\* \/ \*0\.1 SOL\*/,
  );
  assert.match(
    it.depositStatusBullets("0.01", "0.1", false),
    /• Deposito: \*Rilevato\* — \*0\.01\* \/ \*0\.1 SOL\*/,
  );
  assert.match(
    it.depositStatusBullets("0.1", "0.1", true),
    /• Deposito: \*Confermato\* \(\*0\.1 SOL\*\)/,
  );
  const withDep = formatDealStatus(
    { ...baseDeal, status: "awaiting_deposit" },
    {
      depositLine: it.depositStatusBullets("0.01", "0.1", false),
      depositPhase: "rilevato",
    },
  );
  assert.match(withDep, /— Rilevato/);
  assert.ok(!/In attesa deposito/.test(withDep));
  assert.ok(!withDep.includes(baseDeal.escrowAddress));
  const confirmed = formatDealStatus(
    { ...baseDeal, status: "funded" },
    {
      depositLine: it.depositStatusBullets("0.1", "0.1", true),
      depositPhase: "confermato",
    },
  );
  assert.match(confirmed, /— Confermato/);
  assert.ok(!/In attesa deposito/.test(confirmed));
}

// Altre info: include Stato (parti/importo/deposito) + fee 5%; niente split 2.5 / 95%
{
  const info = it.altreInfoMenu(baseDeal, {
    depositLine: it.depositStatusBullets("0.1", "0.1", true),
  });
  assert.match(info, /#deadbeef/);
  assert.match(info, /Fondato/);
  assert.match(info, /• Seller: @seller_y/);
  assert.match(info, /• Buyer: @buyer_x/);
  assert.match(info, /• Deposito: \*Confermato\*/);
  assert.match(info, /• Fee: \*5%\*/);
  assert.match(info, /• Rimborso: senza fee/);
  assert.match(info, /• Supporto: \*Disputa\*/);
  assert.ok(!/2\.5%/.test(info));
  assert.ok(!/95%/.test(info));
  assert.ok(!info.includes(baseDeal.escrowAddress));

  const withCollab = it.altreInfoMenu({
    ...baseDeal,
    collaboratorWallet: "Collab111111111111111111111111111111111111",
  });
  assert.match(withCollab, /• Fee: \*5%\*/);
  assert.ok(!/2\.5%/.test(withCollab));
}

// Vouch gate copy: «Sono entrato» (bottone + body), mai «Ho entrato»
{
  assert.match(it.needVouchJoin("https://t.me/+x"), /Sono entrato/);
  assert.match(it.vouchStillOut("https://t.me/+x"), /Sono entrato/);
  assert.ok(!/Ho entrato/.test(it.needVouchJoin("https://t.me/+x")));
  assert.ok(!/Ho entrato/.test(it.vouchStillOut("https://t.me/+x")));
}

// Role gates: seller non avvia Paga/rimborso; buyer non conferma rilascio (party-only A3)
{
  assert.equal(canStartBuyerPay(baseDeal, 10), true);
  assert.equal(canStartBuyerPay(baseDeal, 20), false);
  assert.equal(canStartBuyerPay(baseDeal, 999), false); // terzo
  assert.equal(canStartRefund(baseDeal, 10), true);
  assert.equal(canStartRefund(baseDeal, 20), false); // seller NON avvia rimborso
  assert.equal(canStartRefund(baseDeal, 999), false);
  assert.equal(canConfirmSellerPay(baseDeal, 20), true);
  assert.equal(canConfirmSellerPay(baseDeal, 10), false);
  assert.equal(canConfirmSellerPay(baseDeal, 999), false);
  assert.equal(canMarkShipped(baseDeal, 20), true);
  assert.equal(canMarkShipped(baseDeal, 10), false);
  assert.match(it.buyerOnlyRefund(baseDeal), /Solo @buyer\\_x/);
  assert.match(it.buyerOnlyRefund(baseDeal), /Disputa|Altre info/);
}

// Refund 1/2: buyer ha votato → solo seller conferma (2° voto OK)
{
  const pendingRefund: Deal = {
    ...baseDeal,
    status: "refund_pending",
    refundVotes: [10],
  };
  assert.equal(pendingVoterId(pendingRefund, pendingRefund.refundVotes), 20);
  assert.equal(canConfirmRefund(pendingRefund, 20), true);
  assert.equal(canConfirmRefund(pendingRefund, 10), false); // buyer NON conferma
  assert.equal(canConfirmRefund(pendingRefund, 999), false);
  assert.equal(
    canConfirmPendingVote(pendingRefund, pendingRefund.refundVotes, 10),
    false,
  );
}

// Abuse: seller non può essere first voter (canStartRefund false); se legacy vote seller → buyer conferma
{
  assert.equal(canStartRefund(baseDeal, 20), false);
  const pendingRefund: Deal = {
    ...baseDeal,
    status: "refund_pending",
    refundVotes: [20],
  };
  assert.equal(pendingVoterId(pendingRefund, pendingRefund.refundVotes), 10);
  assert.equal(canConfirmRefund(pendingRefund, 10), true);
  assert.equal(canConfirmRefund(pendingRefund, 20), false);
}

// Release 1/2: buyer votato → solo seller (mirror pay)
{
  const pendingRelease: Deal = {
    ...baseDeal,
    status: "release_pending",
    releaseVotes: [10],
  };
  assert.equal(
    canConfirmPendingVote(pendingRelease, pendingRelease.releaseVotes, 20),
    true,
  );
  assert.equal(
    canConfirmPendingVote(pendingRelease, pendingRelease.releaseVotes, 10),
    false,
  );
  assert.equal(canConfirmSellerPay(pendingRelease, 10), false);
  assert.equal(canConfirmSellerPay(pendingRelease, 20), true);
}

// Annulla 1/2: parti sì, terzo no
{
  assert.equal(canCancelDualConfirm(baseDeal, 10), true);
  assert.equal(canCancelDualConfirm(baseDeal, 20), true);
  assert.equal(canCancelDualConfirm(baseDeal, 999), false);
}

// Wallet turn: solo parte attesa
{
  const askSeller: Deal = { ...baseDeal, status: "awaiting_seller_wallet" };
  assert.equal(canSetWalletNow(askSeller, 20), true);
  assert.equal(canSetWalletNow(askSeller, 10), false);
  const askBuyer: Deal = { ...baseDeal, status: "awaiting_buyer_wallet" };
  assert.equal(canSetWalletNow(askBuyer, 10), true);
  assert.equal(canSetWalletNow(askBuyer, 20), false);
}

// Card pinnata: Seller/Buyer bullets + Invito quando presente
{
  const card = it.groupSetupCard({
    ...baseDeal,
    status: "awaiting_tos",
    inviteCode: "KEYTEST",
    tosProduct: "Servizio test",
    priceEur: "10",
    tosConditions: "subito",
  });
  assert.match(card, /• Seller: @seller\\_y/);
  assert.match(card, /• Buyer: @buyer\\_x/);
  assert.match(card, /• Invito: \*KEYTEST\*/);
  assert.ok(
    !/·/.test(
      card
        .split("\n")
        .find((l) => l.includes("Seller") || l.includes("Buyer")) ?? "",
    ),
  );
}

// Copy conferma
{
  const ask = it.selfConfirmAsk(baseDeal, "dispute_open", 10);
  assert.match(ask, /@buyer/);
  assert.match(ask.toLowerCase(), /disputa/);
  assert.equal(it.frozenInDispute, "In disputa.");
  assert.equal(it.wrongStatus("disputed"), "In disputa.");
}

// Admin DM fail: CTA invite + deep-link (niente vicolo cieco)
{
  const start = "https://t.me/ESCROWITAbot?start=deal_deadbeef";
  const invite = "https://t.me/+invite";
  const fail = it.disputeAdminDmFailed(baseDeal, invite, start);
  assert.match(fail, /non riesco a scrivere/i);
  assert.match(fail, /\/deal deadbeef/);
  assert.ok(fail.includes(start));
  assert.ok(fail.includes(invite));
  const kb = disputeAdminFallbackKeyboard({
    inviteLink: invite,
    startLink: start,
  });
  const urls = kb.inline_keyboard.flat().map((b) => ("url" in b ? b.url : ""));
  assert.ok(urls.includes(invite));
  assert.ok(urls.includes(start));
}

// Dual-confirm 1/2: Confermo + Annulla (pay e refund)
{
  assert.deepEqual(labelsOf(sellerConfirmPayKeyboard()), [
    "✅ Confermo",
    "Annulla",
  ]);
  assert.deepEqual(callbacksOf(sellerConfirmPayKeyboard()), [
    "seller_confirm_pay",
    "cancel_confirm_pay",
  ]);
  assert.deepEqual(labelsOf(refundConfirmKeyboard()), [
    "✅ Confermo",
    "Annulla",
  ]);
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
