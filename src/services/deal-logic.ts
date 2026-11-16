import type { Deal, PartyRole } from "../types.js";
import { config } from "../config.js";

export function parseAmount(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  // SOL: fino a 9 decimali
  if (!/^\d+(\.\d{1,9})?$/.test(normalized)) return null;
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

export function bothWalletsPresent(deal: Deal): boolean {
  return Boolean(deal.buyerWallet && deal.sellerWallet);
}

export function tosAccepted(deal: Deal): boolean {
  return Boolean(deal.tosText && deal.tosAcceptedAt);
}

/** Stati precedenti al deposito escrow (ToS / wallet ancora aperti). */
export function isPreDepositSetup(status: Deal["status"]): boolean {
  return (
    status === "awaiting_tos" ||
    status === "awaiting_tos_confirm" ||
    status === "awaiting_seller_wallet" ||
    status === "awaiting_buyer_wallet"
  );
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
  displayName?: string,
): Partial<Deal> | null {
  if (deal.buyerId === userId || deal.sellerId === userId) {
    const patch: Partial<Deal> = {};
    if (deal.buyerId === userId) {
      if (username && deal.buyerUsername !== username) {
        patch.buyerUsername = username;
      }
      if (displayName && deal.buyerDisplayName !== displayName) {
        patch.buyerDisplayName = displayName;
      }
    }
    if (deal.sellerId === userId) {
      if (username && deal.sellerUsername !== username) {
        patch.sellerUsername = username;
      }
      if (displayName && deal.sellerDisplayName !== displayName) {
        patch.sellerDisplayName = displayName;
      }
    }
    return Object.keys(patch).length ? patch : null;
  }

  // Slot libero = ruolo opposto al creator se quel lato manca
  if (deal.creatorRole === "buyer" && deal.sellerId == null) {
    return {
      sellerId: userId,
      sellerUsername: username,
      sellerDisplayName: displayName,
    };
  }
  if (deal.creatorRole === "seller" && deal.buyerId == null) {
    return {
      buyerId: userId,
      buyerUsername: username,
      buyerDisplayName: displayName,
    };
  }

  // Se per qualche motivo manca il lato creator (non dovrebbe)
  if (deal.buyerId == null) {
    return {
      buyerId: userId,
      buyerUsername: username,
      buyerDisplayName: displayName,
    };
  }
  if (deal.sellerId == null) {
    return {
      sellerId: userId,
      sellerUsername: username,
      sellerDisplayName: displayName,
    };
  }

  return null;
}

/** Confronta username / display name salvati; se cambiano restituisce patch + testo alert. */
export function detectIdentityChange(
  deal: Deal,
  userId: number,
  username: string | undefined,
  displayName: string | undefined,
): { patch: Partial<Deal>; alert?: string } | null {
  const isBuyer = deal.buyerId === userId;
  const isSeller = deal.sellerId === userId;
  if (!isBuyer && !isSeller) return null;

  const role = isBuyer ? "buyer" : "seller";
  const prevUser = isBuyer ? deal.buyerUsername : deal.sellerUsername;
  const prevName = isBuyer ? deal.buyerDisplayName : deal.sellerDisplayName;
  const patch: Partial<Deal> = {};
  const changes: string[] = [];

  if (username && prevUser && username !== prevUser) {
    if (isBuyer) patch.buyerUsername = username;
    else patch.sellerUsername = username;
    changes.push(`@${prevUser} → @${username}`);
  } else if (username && !prevUser) {
    if (isBuyer) patch.buyerUsername = username;
    else patch.sellerUsername = username;
  }

  if (displayName && prevName && displayName !== prevName) {
    if (isBuyer) patch.buyerDisplayName = displayName;
    else patch.sellerDisplayName = displayName;
    changes.push(`«${prevName}» → «${displayName}»`);
  } else if (displayName && !prevName) {
    if (isBuyer) patch.buyerDisplayName = displayName;
    else patch.sellerDisplayName = displayName;
  }

  if (Object.keys(patch).length === 0) return null;
  return {
    patch,
    alert: changes.length ? changes.join("; ") : undefined,
  };
}

export function startGroupPayload(dealId: string): string {
  // Telegram startgroup payload: max 64 chars, A-Z a-z 0-9 _ -
  return `d_${dealId}`;
}

export function parseStartGroupPayload(payload: string): string | null {
  const m = payload.trim().match(/^d_([a-f0-9]{8})$/i);
  return m ? m[1].toLowerCase() : null;
}
