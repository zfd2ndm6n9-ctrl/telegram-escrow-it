/**
 * Profili deal orfani noti (store perso su redeploy, fondi ancora on-chain).
 * Usati da `npm run recover:escrow` e da comandi admin di ripristino.
 */
export type OrphanProfile = {
  dealId: string;
  amount: string;
  asset: "SOL";
  escrowAddress: string;
  sellerWallet: string;
  buyerWallet: string;
  /** Note operative (italiano, per log/docs) */
  note: string;
};

/** Deal #82978c05 — Escrow #82978c05, fondi verificati on-chain dopo Manual Deploy PR #10. */
export const ORPHAN_82978C05: OrphanProfile = {
  dealId: "82978c05",
  amount: "0.05",
  asset: "SOL",
  escrowAddress: "BmzhHwdqgx4xTETKtExL1hhTJ43PHhcDyqoqV6FZbmE9",
  sellerWallet: "57fv8agNAjcsaLgodeNDjexTo5azsJpjLyMigaZnfVNP",
  buyerWallet: "5J1vt1UeHJL1ZKfznpwhNxrSe241HZ7iMwheVS9cGr6f",
  note: "Store JSON perso su Render (disco ephemeral). Escrow derivato da dealId+HMAC ancora funded.",
};

const BY_ID: Record<string, OrphanProfile> = {
  [ORPHAN_82978C05.dealId]: ORPHAN_82978C05,
};

export function getOrphanProfile(dealId: string): OrphanProfile | undefined {
  return BY_ID[dealId.trim().toLowerCase()];
}

export function listOrphanProfiles(): OrphanProfile[] {
  return Object.values(BY_ID);
}
