/**
 * Simula callback wrong-party su dual-confirm / path sensibili.
 * Assert: reject (gate false) — nessuno stato cambia se il gate è false.
 *
 * Happy path + abuse path (BET-88 / audit A3):
 * - Refund: buyer avvia → seller conferma; buyer-admin NON conferma 2/2
 * - Release: buyer avvia → seller conferma; buyer NON conferma 2/2
 * - Annulla: parti ok; terzo no
 * - Wallet / ship / pay start: ruoli fissi
 *
 * npm exec tsx scripts/check-dual-confirm-roles.ts
 */
import assert from "node:assert/strict";
import {
  canCancelDualConfirm,
  canConfirmPendingVote,
  canConfirmRefund,
  canConfirmSellerPay,
  canMarkShipped,
  canSetWalletNow,
  canStartBuyerPay,
  canStartRefund,
  isParty,
  pendingVoterId,
} from "../src/services/deal-logic.js";
import type { Deal } from "../src/types.js";

const BUYER = 10;
const SELLER = 20;
const THIRD = 999;

const base: Deal = {
  id: "roledead",
  creatorId: BUYER,
  creatorRole: "buyer",
  buyerId: BUYER,
  buyerUsername: "buyer_x",
  sellerId: SELLER,
  sellerUsername: "seller_y",
  amount: "0.1",
  asset: "SOL",
  status: "funded",
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Simula: se gate false → reject (alert, no state). Se true → voto consentito. */
function assertReject(
  label: string,
  allowed: boolean,
  expectAllow: boolean,
): void {
  assert.equal(
    allowed,
    expectAllow,
    `${label}: expected allow=${expectAllow}, got ${allowed}`,
  );
}

// ——— Happy: refund buyer-start → seller 2° voto ———
{
  const d: Deal = {
    ...base,
    status: "refund_pending",
    refundVotes: [BUYER],
  };
  assert.equal(pendingVoterId(d, d.refundVotes), SELLER);
  assertReject("refund confirm seller", canConfirmRefund(d, SELLER), true);
  assertReject("refund confirm buyer (abuse)", canConfirmRefund(d, BUYER), false);
  assertReject("refund confirm third", canConfirmRefund(d, THIRD), false);
  // Mirror via generic pending vote helper
  assertReject(
    "pending vote buyer on refund",
    canConfirmPendingVote(d, d.refundVotes, BUYER),
    false,
  );
}

// ——— Abuse: seller non avvia rimborso; solo buyer canStartRefund ———
{
  assertReject("refund start buyer", canStartRefund(base, BUYER), true);
  assertReject("refund start seller", canStartRefund(base, SELLER), false);
  assertReject("refund start third", canStartRefund(base, THIRD), false);
}

// ——— Legacy: se seller fosse first voter, buyer conferma 2° (gate confirm) ———
{
  const d: Deal = {
    ...base,
    status: "refund_pending",
    refundVotes: [SELLER],
  };
  assert.equal(pendingVoterId(d, d.refundVotes), BUYER);
  assertReject("refund confirm buyer", canConfirmRefund(d, BUYER), true);
  assertReject("refund confirm seller (abuse)", canConfirmRefund(d, SELLER), false);
}

// ——— Abuse: buyer already voted tries confirm_refund again ———
{
  const d: Deal = {
    ...base,
    status: "refund_pending",
    refundVotes: [BUYER],
  };
  // Stesso check del handler: canConfirmRefund(buyer) === false → alert, no asUserId:seller
  assert.equal(canConfirmRefund(d, BUYER), false);
  assert.ok(d.refundVotes.includes(BUYER));
  assert.ok(!d.refundVotes.includes(SELLER));
}

// ——— Happy + abuse: release buyer-first ———
{
  assertReject("pay start buyer", canStartBuyerPay(base, BUYER), true);
  assertReject("pay start seller", canStartBuyerPay(base, SELLER), false);
  assertReject("pay start third", canStartBuyerPay(base, THIRD), false);

  const d: Deal = {
    ...base,
    status: "release_pending",
    releaseVotes: [BUYER],
  };
  assertReject("seller confirm pay", canConfirmSellerPay(d, SELLER), true);
  assertReject("buyer confirm pay (abuse)", canConfirmSellerPay(d, BUYER), false);
  assertReject(
    "pending release buyer",
    canConfirmPendingVote(d, d.releaseVotes, BUYER),
    false,
  );
  assertReject(
    "pending release seller",
    canConfirmPendingVote(d, d.releaseVotes, SELLER),
    true,
  );
}

// ——— Annulla dual-confirm ———
{
  assertReject("cancel buyer", canCancelDualConfirm(base, BUYER), true);
  assertReject("cancel seller", canCancelDualConfirm(base, SELLER), true);
  assertReject("cancel third", canCancelDualConfirm(base, THIRD), false);
  assert.equal(isParty(base, THIRD), false);
}

// ——— Consegnato ———
{
  assertReject("ship seller", canMarkShipped(base, SELLER), true);
  assertReject("ship buyer", canMarkShipped(base, BUYER), false);
}

// ——— Wallet prompts ———
{
  const sellerTurn: Deal = { ...base, status: "awaiting_seller_wallet" };
  assertReject("wallet seller turn seller", canSetWalletNow(sellerTurn, SELLER), true);
  assertReject("wallet seller turn buyer", canSetWalletNow(sellerTurn, BUYER), false);
  assertReject("wallet seller turn third", canSetWalletNow(sellerTurn, THIRD), false);

  const buyerTurn: Deal = { ...base, status: "awaiting_buyer_wallet" };
  assertReject("wallet buyer turn buyer", canSetWalletNow(buyerTurn, BUYER), true);
  assertReject("wallet buyer turn seller", canSetWalletNow(buyerTurn, SELLER), false);
}

// ——— 2/2 già chiuso: pending null → confirm gate false ———
{
  const done: Deal = {
    ...base,
    status: "refund_pending",
    refundVotes: [BUYER, SELLER],
  };
  assert.equal(pendingVoterId(done, done.refundVotes), null);
  assertReject("confirm after 2/2 buyer", canConfirmRefund(done, BUYER), false);
  assertReject("confirm after 2/2 seller", canConfirmRefund(done, SELLER), false);
}

console.log("check-dual-confirm-roles: ok");
