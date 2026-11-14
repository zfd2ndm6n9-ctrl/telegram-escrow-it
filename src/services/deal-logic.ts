import type { Deal, PartyRole } from "../types.js";
import { config } from "../config.js";

export function parseAmount(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return normalized;
}

export function isParty(deal: Deal, userId: number): boolean {
  return deal.buyerId === userId || deal.sellerId === userId;
}

export function isAdminUser(userId: number): boolean {
  if (!config.adminTelegramId) return false;
  return String(userId) === config.adminTelegramId;
}

export function isAllowedHuman(deal: Deal, userId: number): boolean {
  if (isParty(deal, userId)) return true;
  if (isAdminUser(userId)) return true;
  return false;
}

export function bothPartiesPresent(deal: Deal): boolean {
  return deal.buyerId != null && deal.sellerId != null;
}

export function addUniqueVote(votes: number[], userId: number): number[] {
  if (votes.includes(userId)) return votes;
  return [...votes, userId];
}

export function counterpartRole(role: PartyRole): PartyRole {
  return role === "buyer" ? "seller" : "buyer";
}

export function assignJoiningParty(
  deal: Deal,
  userId: number,
  username?: string,
): Partial<Deal> | null {
  if (deal.buyerId === userId || deal.sellerId === userId) {
    const patch: Partial<Deal> = {};
    if (deal.buyerId === userId && username && deal.buyerUsername !== username) {
      patch.buyerUsername = username;
    }
    if (deal.sellerId === userId && username && deal.sellerUsername !== username) {
      patch.sellerUsername = username;
    }
    return Object.keys(patch).length ? patch : null;
  }

  // Slot libero = ruolo opposto al creator se quel lato manca
  if (deal.creatorRole === "buyer" && deal.sellerId == null) {
    return { sellerId: userId, sellerUsername: username };
  }
  if (deal.creatorRole === "seller" && deal.buyerId == null) {
    return { buyerId: userId, buyerUsername: username };
  }

  // Se per qualche motivo manca il lato creator (non dovrebbe)
  if (deal.buyerId == null) {
    return { buyerId: userId, buyerUsername: username };
  }
  if (deal.sellerId == null) {
    return { sellerId: userId, sellerUsername: username };
  }

  return null;
}

export function startGroupPayload(dealId: string): string {
  // Telegram startgroup payload: max 64 chars, A-Z a-z 0-9 _ -
  return `d_${dealId}`;
}

export function parseStartGroupPayload(payload: string): string | null {
  const m = payload.trim().match(/^d_([a-f0-9]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}
