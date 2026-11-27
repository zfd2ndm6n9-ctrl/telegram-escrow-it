/**
 * Smoke: A2 lookalike SOL in awaiting_deposit + extract da testo.
 * npm exec tsx scripts/check-sol-address-phishing.ts
 */
import assert from "node:assert/strict";
import {
  findSolAddressLookalikeInText,
  looksLikeSolAddressAttempt,
} from "../src/services/solana/amounts.js";
import { it } from "../src/messages/it.js";

const ESCROW = "57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP";
const FAKE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

assert.equal(looksLikeSolAddressAttempt(ESCROW), true);
assert.equal(looksLikeSolAddressAttempt("ciao"), false);
assert.equal(findSolAddressLookalikeInText(ESCROW), ESCROW);
assert.equal(
  findSolAddressLookalikeInText(`manda qui ${FAKE} grazie`),
  FAKE,
);
assert.equal(findSolAddressLookalikeInText("ok dopo"), undefined);

// Legitimate escrow paste must be distinguishable from phishing
assert.notEqual(FAKE, ESCROW);
assert.equal(
  findSolAddressLookalikeInText(FAKE) === ESCROW,
  false,
  "fake must not equal escrow",
);

assert.match(it.solAddressPhishingBlocked, /bot/i);
assert.ok(it.solAddressPhishingBlocked.length < 120, "copy must stay short");

console.log("check-sol-address-phishing: ok");
