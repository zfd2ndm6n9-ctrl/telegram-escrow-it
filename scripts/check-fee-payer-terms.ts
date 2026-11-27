/**
 * Smoke: fee-payer step in DM / group terms wizard + deposit lock helper.
 * npm exec tsx scripts/check-fee-payer-terms.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  feePayerKeyboard,
} from "../src/keyboards/menus.js";
import {
  blankTermsPatch,
  composeTosText,
  feePayerLabel,
  formatTosBullets,
  nextDmTermsStep,
  termsReadyForConfirm,
} from "../src/services/deal-logic.js";
import {
  depositLamportsForFeePayer,
} from "../src/services/solana/fees.js";
import { it } from "../src/messages/it.js";
import type { Deal } from "../src/types.js";

const root = resolve(import.meta.dirname, "..");
const typesSrc = readFileSync(resolve(root, "src/types.ts"), "utf8");
const menusSrc = readFileSync(resolve(root, "src/keyboards/menus.ts"), "utf8");
const dmSrc = readFileSync(resolve(root, "src/services/dm-terms.ts"), "utf8");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const lifeSrc = readFileSync(
  resolve(root, "src/handlers/group-lifecycle.ts"),
  "utf8",
);
const tosSrc = readFileSync(
  resolve(root, "src/services/tos-accept.ts"),
  "utf8",
);

assert.match(typesSrc, /FeePayer/);
assert.match(typesSrc, /"fee_payer"/);
assert.match(menusSrc, /feePayerKeyboard/);
assert.match(menusSrc, /terms_fee:buyer:/);
assert.match(dmSrc, /applyFeePayerChoice/);
assert.match(dmSrc, /feePayerKeyboard/);
assert.match(creaSrc, /terms_fee:\(buyer\|seller\)/);
assert.match(lifeSrc, /terms_fee:\(buyer\|seller\)/);
assert.match(tosSrc, /convertPriceEurToDepositAmount/);

const kb = feePayerKeyboard("abcdef12");
assert.equal(kb.inline_keyboard?.[0]?.length, 2);
assert.equal(
  kb.inline_keyboard?.[0]?.[0]?.callback_data,
  "terms_fee:buyer:abcdef12",
);
assert.equal(
  kb.inline_keyboard?.[0]?.[1]?.callback_data,
  "terms_fee:seller:abcdef12",
);

const base = {
  id: "abcdef12",
  creatorId: 1,
  creatorRole: "seller" as const,
  asset: "SOL" as const,
  amount: "",
  status: "awaiting_group" as const,
  escrowAddress: "Escrow1111111111111111111111111111111111111",
  releaseVotes: [],
  refundVotes: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

let deal = { ...base } as Deal;
assert.equal(nextDmTermsStep(deal), "product");

deal = { ...deal, tosProduct: "Servizio X" };
assert.equal(nextDmTermsStep(deal), "price");

deal = { ...deal, priceEur: "10" };
assert.equal(nextDmTermsStep(deal), "conditions");

deal = { ...deal, tosConditions: "Consegna 24h" };
assert.equal(nextDmTermsStep(deal), "fee_payer");
assert.equal(termsReadyForConfirm(deal), false);

deal = { ...deal, feePayer: "buyer" };
assert.equal(nextDmTermsStep(deal), null);
assert.equal(termsReadyForConfirm(deal), false); // manca tosText

const tosText = composeTosText(
  deal.tosProduct!,
  deal.priceEur!,
  deal.tosConditions!,
  deal.feePayer,
);
deal = { ...deal, tosText };
assert.equal(termsReadyForConfirm(deal), true);
assert.match(tosText, /Fee a carico: Buyer/);
assert.match(formatTosBullets(deal), /Fee a carico: Buyer/);
assert.equal(feePayerLabel("seller"), "Seller");

const ask = it.dmTermsAsk("fee_payer", deal);
assert.match(ask, /Chi paga la fee/);
assert.match(ask, /\+5%/);
assert.match(ask, /−5%/);

const blank = blankTermsPatch(42, { inGroup: true });
assert.equal(blank.feePayer, undefined);
assert.equal(blank.termsWizardInGroup, true);

assert.equal(depositLamportsForFeePayer(10_000_000n, "buyer"), 10_500_000n);
assert.equal(depositLamportsForFeePayer(10_000_000n, "seller"), 10_000_000n);

console.log("check-fee-payer-terms: OK");
