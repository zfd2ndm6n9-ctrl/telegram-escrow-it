/**
 * Smoke: postShipAsk / postBuyerAfterShip idempotenti (niente doppia card).
 * npm exec tsx scripts/check-delivery-cta-idempotency.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DealStore } from "../src/store/deals.js";
import {
  postBuyerAfterShip,
  postShipAsk,
} from "../src/services/group-setup.js";
import type { Deal } from "../src/types.js";

const root = resolve(import.meta.dirname, "..");
const setupSrc = readFileSync(
  resolve(root, "src/services/group-setup.ts"),
  "utf8",
);
assert.match(setupSrc, /deliveryCtaInFlight/, "in-process lock presente");
assert.match(setupSrc, /deliveryCta:\s*"ship_ask"/, "claim ship_ask");
assert.match(
  setupSrc,
  /deliveryCta:\s*"buyer_after_ship"/,
  "claim buyer_after_ship",
);

const typesSrc = readFileSync(resolve(root, "src/types.ts"), "utf8");
assert.match(
  typesSrc,
  /deliveryCta\?:\s*"ship_ask"\s*\|\s*"buyer_after_ship"/,
  "Deal.deliveryCta tipizzato",
);

const creatorSrc = readFileSync(
  resolve(root, "src/services/group-creator.ts"),
  "utf8",
);
assert.doesNotMatch(
  creatorSrc,
  /setChatTitle\(chatId,\s*title\)/,
  "createEscrowGroup: niente setChatTitle ridondante",
);
assert.match(creatorSrc, /Promise\.all/, "create parallela");

const createDealSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
assert.match(
  createDealSrc,
  /skipHarden:\s*true/,
  "helper create: skip harden ridondante",
);
assert.match(
  createDealSrc,
  /replyCreatorInviteDm/,
  "DM link creator ancora presente",
);
// Nel blocco helper-create: DM subito, poi startDealInGroup (non il contrario).
{
  const block = createDealSrc.slice(
    createDealSrc.indexOf("if (created.ok)"),
    createDealSrc.indexOf("// Create fallita"),
  );
  const dmIdx = block.indexOf("await replyCreatorInviteDm(");
  const startIdx = block.indexOf("await startDealInGroup(");
  assert.ok(
    dmIdx >= 0 && startIdx > dmIdx,
    "DM link prima di startDealInGroup nel path helper create",
  );
}

// Store claim: due update sequenziali → un solo deliveryCta
{
  const dir = mkdtempSync(join(tmpdir(), "escrow-cta-"));
  try {
    const store = new DealStore(dir);
    const created = store.create({
      creatorId: 1,
      creatorRole: "seller",
      asset: "SOL",
      escrowAddress: "Escrow1111111111111111111111111111111111111",
    });
    store.update(created.id, {
      status: "funded",
      groupChatId: -100999,
      buyerId: 10,
      sellerId: 1,
      buyerUsername: "buyer_x",
      sellerUsername: "seller_y",
      tosProduct: "Account test",
      priceEur: "10",
    });

    const live = store.get(created.id)!;
    assert.equal(live.deliveryCta, undefined);

    // Simula claim come postShipAsk (senza Telegram)
    const claimed =
      store.update(live.id, { deliveryCta: "ship_ask", botPromptIds: [42] }) ??
      live;
    assert.equal(claimed.deliveryCta, "ship_ask");
    assert.deepEqual(claimed.botPromptIds, [42]);

    // Secondo path: già posta + prompt tracked → skip (logica di postShipAsk)
    const again = store.get(claimed.id)!;
    const shouldSkip =
      again.deliveryCta === "ship_ask" &&
      (again.botPromptIds?.length ?? 0) > 0 &&
      !again.sellerShippedAt;
    assert.equal(shouldSkip, true);

    // Dopo clear prompts (annulla disputa): riposta
    store.update(again.id, { botPromptIds: [] });
    const afterClear = store.get(again.id)!;
    const shouldRepost =
      afterClear.deliveryCta === "ship_ask" &&
      (afterClear.botPromptIds?.length ?? 0) === 0;
    assert.equal(shouldRepost, true);

    // Export callable (typecheck smoke) — no network
    assert.equal(typeof postShipAsk, "function");
    assert.equal(typeof postBuyerAfterShip, "function");

    const asDeal = store.get(created.id)! satisfies Deal;
    assert.ok(asDeal.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("check-delivery-cta-idempotency: ok");
