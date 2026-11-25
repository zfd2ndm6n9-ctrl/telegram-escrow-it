/**
 * Smoke: /avvia awaiting-counterpart copy + dedupe vs living card.
 * Helper path → «Entra come buyer/seller» + link; manual → entra/scrivi (no «controparte»).
 * npm exec tsx scripts/check-avvia-status-reply.ts
 */
import {
  avviaAutoBindReply,
  shouldSendAvviaAutoBindStatus,
} from "../src/services/group-setup.js";
import { it } from "../src/messages/it.js";
import {
  entraComeMissingPartyLabel,
  inviteMissingPartyKeyboard,
} from "../src/keyboards/menus.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dealSellerManual = { id: "2b5f532b", creatorRole: "seller" as const };
const dealBuyerManual = { id: "abc12345", creatorRole: "buyer" as const };
const dealSellerHelper = {
  id: "2b5f532b",
  creatorRole: "seller" as const,
  groupCreatedVia: "helper" as const,
  counterpartInviteLink: "https://t.me/+buyerInvite",
};
const dealBuyerHelper = {
  id: "abc12345",
  creatorRole: "buyer" as const,
  groupCreatedVia: "helper" as const,
  counterpartInviteLink: "https://t.me/+sellerInvite",
};

for (const reason of ["none", "need_message", "too_many"] as const) {
  for (const deal of [dealSellerManual, dealBuyerManual]) {
    const text = avviaAutoBindReply(reason, deal);
    assert(typeof text === "string" && text.trim().length > 0, `${reason} empty`);
    assert(!/undefined|null/i.test(text), `${reason} placeholder leak`);
    assert(!/controparte/i.test(text), `${reason} must not say controparte`);
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
        `${reason} missing next-step invite (manual)`,
      );
    }
  }
}

for (const reason of ["none", "need_message"] as const) {
  for (const deal of [dealSellerHelper, dealBuyerHelper]) {
    const text = avviaAutoBindReply(reason, deal);
    assert(!/controparte/i.test(text), `helper ${reason} must not say controparte`);
    assert(!/entra o scrivi/i.test(text), `helper ${reason} must not ask entra/scrivi`);
    assert(!/Invita il/i.test(text), `helper ${reason} must not say Invita`);
    const expected = deal.creatorRole === "seller" ? "buyer" : "seller";
    assert(
      new RegExp(`entra come \\*?${expected}`, "i").test(text),
      `helper ${reason} expected Entra come ${expected}`,
    );
    assert(
      text.includes(deal.counterpartInviteLink),
      `helper ${reason} missing invite link`,
    );
  }
}

// Direct message helper stays aligned.
const direct = it.avviaAwaitingCounterpart(dealSellerManual);
assert(direct.includes("2b5f532b"), "direct missing id");
assert(direct.includes("Buyer"), "seller opener → ask Buyer");
assert(!/controparte/i.test(direct), "direct must not say controparte");

const helperAsk = it.counterpartAsk(dealBuyerHelper);
assert(/Entra come \*seller\*/i.test(helperAsk), "counterpartAsk helper → Entra come seller");
assert(helperAsk.includes("https://t.me/+sellerInvite"), "counterpartAsk helper link");
assert(!/Invita il/i.test(helperAsk), "counterpartAsk must not say Invita");

assert(entraComeMissingPartyLabel("buyer") === "Entra come seller", "label seller");
assert(entraComeMissingPartyLabel("seller") === "Entra come buyer", "label buyer");

const inviteKb = inviteMissingPartyKeyboard("buyer", "https://t.me/+x");
const btn = inviteKb.inline_keyboard[0]?.[0];
assert(btn && "text" in btn && btn.text === "Entra come seller", "keyboard seller label");
assert(btn && "url" in btn && btn.url === "https://t.me/+x", "keyboard url");

const inviteKbBuyer = inviteMissingPartyKeyboard("seller", "https://t.me/+y");
const btnB = inviteKbBuyer.inline_keyboard[0]?.[0];
assert(
  btnB && "text" in btnB && btnB.text === "Entra come buyer",
  "keyboard buyer label",
);

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
