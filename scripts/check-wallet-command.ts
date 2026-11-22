/**
 * Smoke: /wallet must match any reasonable casing and never parse as silent miss.
 * npm exec tsx scripts/check-wallet-command.ts
 */
import { parseWalletCommand } from "../src/handlers/group-commands.js";
import {
  isValidSolAddress,
  looksLikeSolAddressAttempt,
} from "../src/services/solana/index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const FEE_SAMPLE = "57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP";

const cases: Array<{ text: string; matched: boolean; address: string }> = [
  { text: `/wallet ${FEE_SAMPLE}`, matched: true, address: FEE_SAMPLE },
  { text: `/Wallet ${FEE_SAMPLE}`, matched: true, address: FEE_SAMPLE },
  { text: `/WALLET ${FEE_SAMPLE}`, matched: true, address: FEE_SAMPLE },
  {
    text: `/Wallet@EscrowitaBot ${FEE_SAMPLE}`,
    matched: true,
    address: FEE_SAMPLE,
  },
  {
    text: `/wallet@escrowitabot ${FEE_SAMPLE}`,
    matched: true,
    address: FEE_SAMPLE,
  },
  { text: "/wallet", matched: true, address: "" },
  { text: "/Wallet", matched: true, address: "" },
  { text: "/wallets oops", matched: false, address: "" },
  { text: "wallet 57fv", matched: false, address: "" },
  { text: `/avvia ${FEE_SAMPLE}`, matched: false, address: "" },
];

for (const c of cases) {
  const parsed = parseWalletCommand(c.text);
  assert(
    parsed.matched === c.matched,
    `${c.text}: matched=${parsed.matched} expected ${c.matched}`,
  );
  assert(
    parsed.address === c.address,
    `${c.text}: address=${parsed.address} expected ${c.address}`,
  );
}

assert(isValidSolAddress(FEE_SAMPLE), "fee sample must be valid SOL address");
assert(
  !isValidSolAddress("not-an-address"),
  "garbage must fail isValidSolAddress",
);

// Free chat vs wallet attempt (turno wallet: no delete su «ciao»)
assert(!looksLikeSolAddressAttempt("ciao"), "short chat must not look like wallet");
assert(
  !looksLikeSolAddressAttempt("ok mando dopo"),
  "italian chat must not look like wallet",
);
assert(
  looksLikeSolAddressAttempt(FEE_SAMPLE),
  "valid pubkey must look like wallet attempt",
);
assert(
  looksLikeSolAddressAttempt("11111111111111111111111111111111"),
  "long base58 junk must look like attempt",
);
assert(
  !looksLikeSolAddressAttempt("short"),
  "short token must not look like wallet",
);

// Spazi / newline nell'indirizzo: strip → stesso pubkey
const spaced = parseWalletCommand(`/Wallet ${FEE_SAMPLE.slice(0, 20)} ${FEE_SAMPLE.slice(20)}`);
assert(spaced.matched, "spaced address must match command");
assert(spaced.address === FEE_SAMPLE, "spaced address must concatenate");
assert(isValidSolAddress(spaced.address), "spaced address must validate");

console.log("check-wallet-command: OK");
