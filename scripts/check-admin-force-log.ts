/**
 * Smoke: admin force payout gates + deal-log retention + /deal parsers.
 * npm exec tsx scripts/check-admin-force-log.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAdminForcePayoutText } from "../src/handlers/group-commands.js";
import {
  canAdminForcePayout,
  isAdminUser,
} from "../src/services/deal-logic.js";
import { DealLogStore } from "../src/store/deal-logs.js";
import type { Deal } from "../src/types.js";

const BUYER = 10;
const SELLER = 20;
const ADMIN = 42;

const base: Deal = {
  id: "abcd1234",
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

// ——— parseAdminForcePayoutText ———
{
  assert.deepEqual(parseAdminForcePayoutText("/payseller"), {
    kind: "release",
  });
  assert.deepEqual(parseAdminForcePayoutText("/pay_seller@EscrowitaBot"), {
    kind: "release",
  });
  assert.deepEqual(parseAdminForcePayoutText("/release"), { kind: "release" });
  assert.deepEqual(parseAdminForcePayoutText("/refundbuyer"), {
    kind: "refund",
  });
  assert.deepEqual(parseAdminForcePayoutText("/refund_buyer"), {
    kind: "refund",
  });
  assert.deepEqual(parseAdminForcePayoutText("payseller"), { kind: "release" });
  assert.deepEqual(parseAdminForcePayoutText("PaySeller!!"), {
    kind: "release",
  });
  assert.deepEqual(parseAdminForcePayoutText("refundbuyer"), {
    kind: "refund",
  });
  assert.equal(parseAdminForcePayoutText("release"), null, "bare release too ambiguous");
  assert.equal(parseAdminForcePayoutText("ciao"), null);
  assert.equal(parseAdminForcePayoutText("/wallet"), null);
  assert.equal(parseAdminForcePayoutText("/stato"), null);
}

// ——— canAdminForcePayout: solo disputed + admin ———
{
  const funded = { ...base, status: "funded" as const };
  const disputed = { ...base, status: "disputed" as const };

  // isAdminUser depends on env — test structural gate with mocked status.
  // Without ADMIN env, isAdminUser is false for everyone.
  assert.equal(
    canAdminForcePayout(funded, ADMIN),
    false,
    "funded: never force",
  );
  assert.equal(
    canAdminForcePayout(disputed, BUYER) && !isAdminUser(BUYER),
    false,
    "party non-admin: no force",
  );
  // If ADMIN is configured in env as ADMIN, disputed allows; else false.
  const expected =
    disputed.status === "disputed" && isAdminUser(ADMIN);
  assert.equal(
    canAdminForcePayout(disputed, ADMIN),
    expected,
    "disputed+admin matches isAdminUser",
  );
  assert.equal(
    canAdminForcePayout(funded, ADMIN),
    false,
    "admin fuori disputa: no force",
  );
}

// ——— DealLogStore: append → markDeleted → recent limit ———
{
  const dir = mkdtempSync(join(tmpdir(), "deal-logs-"));
  try {
    const logs = new DealLogStore(dir);
    const id = "deadbeef";
    logs.appendUserMessage(id, {
      text: "ciao seller",
      fromId: BUYER,
      username: "buyer_x",
      role: "buyer",
      messageId: 101,
    });
    logs.appendUserMessage(id, {
      text: "/payseller",
      fromId: BUYER,
      username: "buyer_x",
      role: "buyer",
      messageId: 102,
    });
    logs.markDeletedByBot(id, 102);
    logs.appendEvent(id, "Admin force payseller");

    const all = logs.getEntries(id);
    assert.equal(all.length, 3);
    assert.equal(all[1]?.deletedByBot, true);
    assert.match(all[1]?.text ?? "", /payseller/);

    const recent = logs.getEntries(id, { limit: 2 });
    assert.equal(recent.length, 2);
    assert.equal(recent[0]?.messageId, 102);
    assert.equal(recent[1]?.kind, "event");

    const body = logs.formatTranscript(id, { limit: 2 });
    assert.ok(body);
    assert.match(body!, /\[del\]/);
    assert.match(body!, /Admin force/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("check-admin-force-log: ok");
