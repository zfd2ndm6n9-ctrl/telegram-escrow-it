/**
 * Smoke statico: Consegnato seller-only, vouch privacy, grazie collettivo, schedule delete.
 * npm exec tsx scripts/check-delivery-vouch-cleanup.ts
 */
import assert from "node:assert/strict";
import { canMarkShipped } from "../src/services/deal-logic.js";
import {
  GROUP_DELETE_AFTER_MS,
  groupDeleteAtIso,
  scheduleGroupCloseCleanup,
} from "../src/services/group-close-cleanup.js";
import { it } from "../src/messages/it.js";
import { DealStore } from "../src/store/deals.js";
import type { Deal } from "../src/types.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseDeal = {
  id: "deadbeef",
  creatorId: 1,
  creatorRole: "buyer" as const,
  buyerId: 10,
  buyerUsername: "buyer_x",
  sellerId: 20,
  sellerUsername: "seller_y",
  amount: "0.1",
  priceEur: "50",
  tosProduct: "Segreto privato",
  tosConditions: "Condizioni riservate",
  asset: "SOL" as const,
  status: "funded" as const,
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [] as number[],
  refundVotes: [] as number[],
  sellerReviewText: "Ottimo bot",
  buyerReviewText: "Tutto ok",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies Deal;

// Seller-only Consegnato
{
  assert.equal(canMarkShipped(baseDeal, 20), true);
  assert.equal(canMarkShipped(baseDeal, 10), false);
  assert.equal(canMarkShipped(baseDeal, 99), false);
}

// Vouch: prezzo + review, niente prodotto/condizioni
{
  const post = it.vouchChannelPost(baseDeal);
  assert.match(post, /Prezzo/);
  assert.match(post, /50/);
  assert.match(post, /Ottimo bot/);
  assert.match(post, /Tutto ok/);
  assert.doesNotMatch(post, /Segreto privato/);
  assert.doesNotMatch(post, /Condizioni riservate/);
  assert.doesNotMatch(post, /Prodotto/);
  assert.doesNotMatch(post, /Condizioni:/);
}

// Grazie collettivo (non per-user)
{
  assert.equal(it.reviewThanksBoth, "Grazie per la vostra valutazione.");
  assert.notEqual(it.reviewThanksBoth, it.reviewThanks);
}

// Schedule ~30 min
{
  const dir = mkdtempSync(join(tmpdir(), "escrow-cleanup-"));
  try {
    const store = new DealStore(dir);
    const created = store.create({
      creatorId: 1,
      creatorRole: "buyer",
      asset: "SOL",
      escrowAddress: "Escrow1111111111111111111111111111111111111",
    });
    store.update(created.id, {
      status: "released",
      payoutCompleted: true,
      groupChatId: -100123,
      buyerId: 10,
      sellerId: 20,
    });
    const live = store.get(created.id)!;
    const scheduled = scheduleGroupCloseCleanup(store, live);
    assert.ok(scheduled.groupDeleteAt);
    const at = Date.parse(scheduled.groupDeleteAt!);
    const delta = at - Date.now();
    assert.ok(
      delta > GROUP_DELETE_AFTER_MS - 5_000 &&
        delta < GROUP_DELETE_AFTER_MS + 5_000,
      `expected ~30m, got ${delta}ms`,
    );
    // Idempotent
    const again = scheduleGroupCloseCleanup(store, scheduled);
    assert.equal(again.groupDeleteAt, scheduled.groupDeleteAt);
    // Helper ISO
    const iso = groupDeleteAtIso(1_000_000);
    assert.equal(iso, new Date(1_000_000 + GROUP_DELETE_AFTER_MS).toISOString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("check-delivery-vouch-cleanup: ok");
