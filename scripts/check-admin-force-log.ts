/**
 * Smoke: admin force payout gates + deal-log retention + /deal evidence pack.
 * npm exec tsx scripts/check-admin-force-log.ts
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseAdminForcePayoutText } from "../src/handlers/group-commands.js";
import {
  canAdminForcePayout,
  isAdminUser,
} from "../src/services/deal-logic.js";
import { formatDealEvidenceFacts } from "../src/messages/it.js";
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

    // Free chat (non-command) is retained like commands — full dump via /log.
    logs.appendUserMessage(id, {
      text: "ok ti mando il file stasera",
      fromId: SELLER,
      username: "seller_y",
      role: "seller",
      messageId: 103,
    });
    const full = logs.formatTranscript(id);
    assert.match(full!, /ok ti mando il file stasera/);
    assert.match(full!, /ciao seller/);

    // /deal: deleted/cleared msgs (not full chat text).
    const deletedOnly = logs.formatDeletedTranscript(id);
    assert.ok(deletedOnly);
    assert.match(deletedOnly!, /payseller/);
    assert.match(deletedOnly!, /\[del\]/);
    assert.doesNotMatch(deletedOnly!, /ok ti mando il file stasera/);
    assert.doesNotMatch(deletedOnly!, /ciao seller/);
    assert.equal(logs.getDeletedEntries(id).length, 1);

    // Media silent-log: metadata surfaces in /deal evidence even without [del].
    logs.appendUserMessage(id, {
      text: "[video] pack.mp4 · 12s · (senza caption — byte non ritrattenuti)",
      fromId: SELLER,
      username: "seller_y",
      role: "seller",
      messageId: 201,
      mediaType: "video",
    });
    logs.appendUserMessage(id, {
      text: "[photo] 1280×720 · caption: prova deposito",
      fromId: BUYER,
      username: "buyer_x",
      role: "buyer",
      messageId: 202,
      mediaType: "photo",
      deletedByBot: true,
    });
    const evidence = logs.formatAdminDealEvidence(id);
    assert.ok(evidence);
    assert.match(evidence!, /payseller/);
    assert.match(evidence!, /\[video\]/);
    assert.match(evidence!, /\[photo\]/);
    assert.match(evidence!, /\[media\]/); // undeleted media flagged
    assert.match(evidence!, /\[del\]/);
    assert.doesNotMatch(evidence!, /ok ti mando il file stasera/);
    assert.equal(logs.getAdminDealEvidenceEntries(id).length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ——— formatDealEvidenceFacts: card fields + ToS state ———
{
  const withTos: Deal = {
    ...base,
    tosProduct: "Account Netflix 1 mese",
    priceEur: "12,50",
    tosConditions: "Consegna entro 1h via DM",
    tosText: "• Prodotto/servizio: Account Netflix 1 mese\n• Prezzo: 12,50 €\n• Condizioni: Consegna entro 1h via DM",
    tosAcceptedAt: "2026-11-23T15:00:00.000Z",
    amountConfirmedAt: "2026-11-23T15:00:01.000Z",
    inviteCode: "SOFT1",
    status: "disputed",
  };
  const facts = formatDealEvidenceFacts(withTos);
  assert.match(facts, /Account Netflix/);
  assert.match(facts, /12,50/);
  assert.match(facts, /Consegna entro 1h/);
  assert.match(facts, /Importo SOL: \*0\.1 SOL\*/);
  assert.match(facts, /Invito: \*SOFT1\*/);
  assert.match(facts, /ToS: \*accettati\*/);
  assert.match(facts, /Disputa aperta/);

  const pending: Deal = {
    ...base,
    tosProduct: "X",
    priceEur: "5",
    tosConditions: "Y",
    tosText: "t",
    status: "awaiting_tos_confirm",
    amount: "",
  };
  const pendingFacts = formatDealEvidenceFacts(pending);
  assert.match(pendingFacts, /ToS: \*proposti, in attesa/);
  assert.match(pendingFacts, /Importo SOL: \*—\*/);
}

// ——— /deal = facts + deleted only; hygiene logs all humans ———
{
  const root = resolve(import.meta.dirname, "..");
  const startSrc = readFileSync(resolve(root, "src/handlers/start.ts"), "utf8");
  assert.match(
    startSrc,
    /formatDealEvidenceFacts/,
    "/deal uses evidence facts",
  );
  assert.doesNotMatch(
    startSrc,
    /limit:\s*RECENT|const RECENT\s*=\s*40/,
    "/deal no longer caps transcript at 40",
  );
  assert.match(
    startSrc,
    /formatAdminDealEvidence\(dealId\)/,
    "/deal shows [del]+media evidence",
  );
  assert.match(
    startSrc,
    /getAdminDealEvidenceEntries\(dealId\)/,
    "/deal counts evidence entries",
  );
  assert.match(
    startSrc,
    /#\?\(\[a-fA-F0-9\]\{8\}\)\$/,
    "/deal accepts bare hex id in admin DM",
  );
  // Full transcript remains on /log only (not inside replyAdminDealDm).
  const dealDm = startSrc.slice(
    startSrc.indexOf("async function replyAdminDealDm"),
    startSrc.indexOf("export function registerStartHandlers"),
  );
  assert.doesNotMatch(
    dealDm,
    /formatTranscript\(/,
    "/deal DM must not dump full chat transcript",
  );
  assert.match(
    startSrc,
    /bot\.command\("log"[\s\S]*?formatTranscript\(dealId\)/,
    "/log keeps full transcript",
  );

  const hygieneSrc = readFileSync(
    resolve(root, "src/handlers/group-hygiene.ts"),
    "utf8",
  );
  assert.match(
    hygieneSrc,
    /appendUserMessage/,
    "hygiene retains human texts",
  );
  assert.match(
    hygieneSrc,
    /summarizeMessageMedia|message:photo/,
    "hygiene silent-logs media",
  );
  // Must not gate logging on isParty — free chat + pre-assign humans count.
  const logBlock = hygieneSrc.slice(
    hygieneSrc.indexOf("Retention:"),
    hygieneSrc.indexOf("Identity alerts"),
  );
  assert.doesNotMatch(
    logBlock,
    /isParty\(deal/,
    "logging not gated on isParty",
  );
}

console.log("check-admin-force-log: ok");
