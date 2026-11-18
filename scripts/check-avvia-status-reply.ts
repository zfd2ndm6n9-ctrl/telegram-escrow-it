/**
 * Smoke: /avvia awaiting-counterpart must never resolve to empty/silent copy.
 * npm exec tsx scripts/check-avvia-status-reply.ts
 */
import { avviaAutoBindReply } from "../src/services/group-setup.js";
import { it } from "../src/messages/it.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dealSeller = { id: "2b5f532b", creatorRole: "seller" as const };
const dealBuyer = { id: "abc12345", creatorRole: "buyer" as const };

for (const reason of ["none", "need_message", "too_many"] as const) {
  for (const deal of [dealSeller, dealBuyer]) {
    const text = avviaAutoBindReply(reason, deal);
    assert(typeof text === "string" && text.trim().length > 0, `${reason} empty`);
    assert(!/undefined|null/i.test(text), `${reason} placeholder leak`);
    if (reason === "too_many") {
      assert(text === it.autoBindTooMany, "too_many copy mismatch");
      assert(/Troppi membri/i.test(text), "too_many missing hint");
    } else {
      assert(text.includes(deal.id), `${reason} missing deal id`);
      assert(/già avviato/i.test(text), `${reason} missing già avviato`);
      const expectedRole = deal.creatorRole === "seller" ? "Buyer" : "Seller";
      assert(
        text.includes(expectedRole),
        `${reason} expected ${expectedRole} for creatorRole=${deal.creatorRole}`,
      );
      assert(
        /entra o scrivi un messaggio/i.test(text),
        `${reason} missing next-step invite`,
      );
    }
  }
}

// Direct message helper stays aligned with digital-services /avvia UX.
const direct = it.avviaAwaitingCounterpart(dealSeller);
assert(direct.includes("2b5f532b"), "direct missing id");
assert(direct.includes("Buyer"), "seller opener → ask Buyer");

console.log("check-avvia-status-reply: OK");
