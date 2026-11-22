/**
 * Smoke: /avvia awaiting-counterpart copy + dedupe vs living card.
 * npm exec tsx scripts/check-avvia-status-reply.ts
 */
import {
  avviaAutoBindReply,
  shouldSendAvviaAutoBindStatus,
} from "../src/services/group-setup.js";
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

// Living card is the single identify-counterpart prompt — never stack status.
assert(
  shouldSendAvviaAutoBindStatus("none", undefined, 42) === false,
  "first start with card must skip status",
);
assert(
  shouldSendAvviaAutoBindStatus("need_message", undefined, 99) === false,
  "need_message first start with card must skip status",
);
assert(
  shouldSendAvviaAutoBindStatus("none", 10, 10) === false,
  "repeat /avvia with living card must skip status",
);
assert(
  shouldSendAvviaAutoBindStatus("need_message", 7, 7) === false,
  "repeat need_message with living card must skip status",
);
// Card refresh failed → still send status (no silence).
assert(
  shouldSendAvviaAutoBindStatus("none", undefined, undefined) === true,
  "missing card must send status",
);
assert(
  shouldSendAvviaAutoBindStatus("need_message", 5, undefined) === true,
  "lost card after prior id must send status",
);
// too_many always visible (different from card copy).
assert(
  shouldSendAvviaAutoBindStatus("too_many", undefined, 42) === true,
  "too_many always sends",
);
assert(
  shouldSendAvviaAutoBindStatus("too_many", 1, 1) === true,
  "too_many on repeat always sends",
);

console.log("check-avvia-status-reply: OK");
