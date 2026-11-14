import type { Deal } from "../types.js";

export function isParty(deal: Deal, userId: number): boolean {
  return deal.creatorId === userId || deal.counterpartId === userId;
}

export function parseAmount(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return normalized;
}

export function parseCounterpart(raw: string): {
  counterpartId?: number;
  counterpartUsername?: string;
} | null {
  const text = raw.trim();
  if (/^\d{5,15}$/.test(text)) {
    return { counterpartId: Number(text) };
  }
  const m = text.match(/^@?([A-Za-z0-9_]{5,32})$/);
  if (!m) return null;
  return { counterpartUsername: m[1] };
}

/**
 * Se il deal ha solo @username, collega l'id quando la controparte apre il link.
 * Se ha solo id, opzionalmente aggiorna lo username.
 */
export function bindCounterpartIfNeeded(
  deal: Deal,
  userId: number,
  username?: string,
): Partial<Deal> | null {
  if (deal.creatorId === userId) return null;

  if (deal.counterpartId != null && deal.counterpartId !== userId) {
    return null;
  }

  if (deal.counterpartId === userId) {
    if (username && deal.counterpartUsername !== username) {
      return { counterpartUsername: username };
    }
    return null;
  }

  if (deal.counterpartUsername) {
    const expected = deal.counterpartUsername.toLowerCase();
    if (username && username.toLowerCase() === expected) {
      return { counterpartId: userId, counterpartUsername: username };
    }
    // Username mismatch: allow bind only if no username was set on the joining user
    // and deal was created with username — require match.
    return null;
  }

  // Deal created with numeric id only — already handled above if id matches.
  return null;
}

export function addUniqueVote(votes: number[], userId: number): number[] {
  if (votes.includes(userId)) return votes;
  return [...votes, userId];
}
