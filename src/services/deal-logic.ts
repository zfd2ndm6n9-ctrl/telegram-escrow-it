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

/** Importo fissato da entrambe le parti nel gruppo. */
export function amountConfirmed(deal: Deal): boolean {
  return Boolean(deal.amount && deal.amountConfirmedAt);
}

/** Escape minimo per testo utente in Markdown legacy Telegram. */
export function escMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Toglie un eventuale prefisso etichetta ripetuto dall'input utente
 * (es. "prodotto: casa" → "casa") così i bullet non diventano
 * «• Prodotto: prodotto: casa».
 */
export function stripRepeatedLabel(value: string, label: string): string {
  const pattern = new RegExp(
    `^(?:[•\\-*]\\s*)?${label}\\s*[:：\\-–—]\\s*`,
    "i",
  );
  let current = value.trim();
  for (let i = 0; i < 3; i++) {
    const next = current.replace(pattern, "").trim();
    if (next === current) break;
    current = next;
  }
  return current.length > 0 ? current : value.trim();
}

export type TermsFieldLabel = "Prodotto" | "Prezzo" | "Tempi" | "Condizioni";

/** Normalizza un campo termini strutturato prima del persist. */
export function normalizeTosField(
  raw: string,
  label: TermsFieldLabel,
): string {
  let current = stripRepeatedLabel(raw, label);
  // Input legacy «Condizioni: …» quando il campo UI è Tempi
  if (label === "Tempi") {
    current = stripRepeatedLabel(current, "Condizioni");
  }
  return current;
}

/** Lunghezza minima per Prodotto / Tempi. */
export const MIN_TOS_FIELD = 2;

/** Prodotto + Prezzo + Tempi pronti per la conferma controparte. */
export function termsReadyForConfirm(deal: Deal): boolean {
  return Boolean(
    deal.tosProduct &&
      deal.amount &&
      deal.tosConditions &&
      deal.tosText,
  );
}

/**
 * Elenco puntato fisso Prodotto / Prezzo / Tempi.
 * Campi vuoti → `—` (card sempre completa, niente Q&A a catena).
 */
export function formatTosBullets(deal: Deal): string {
  const product = deal.tosProduct
    ? escMd(stripRepeatedLabel(deal.tosProduct, "Prodotto"))
    : "—";
  const price = deal.amount
    ? escMd(`${deal.amount} ${deal.asset}`)
    : "—";
  const tempiRaw = deal.tosConditions
    ? stripRepeatedLabel(
        stripRepeatedLabel(deal.tosConditions, "Tempi"),
        "Condizioni",
      )
    : "";
  const tempi = tempiRaw ? escMd(tempiRaw) : "—";
  return `• Prodotto: ${product}\n• Prezzo: ${price}\n• Tempi: ${tempi}`;
}

/** Compone tosText persistito dall'elenco puntato Prodotto / Prezzo / Tempi. */
export function composeTosText(
  product: string,
  amount: string,
  asset: Deal["asset"],
  tempi: string,
): string {
  const p = normalizeTosField(product, "Prodotto");
  const t = normalizeTosField(tempi, "Tempi");
  return `• Prodotto: ${p}\n• Prezzo: ${amount} ${asset}\n• Tempi: ${t}`;
}

function stripAssetSuffix(raw: string, asset: string): string {
  return raw.replace(new RegExp(`\\s*${asset}\\s*$`, "i"), "").trim();
}

/**
 * Estrae Prodotto / Prezzo / Tempi da etichette (anche con bullet).
 * Restituisce null se manca anche un solo campo etichettato.
 */
function extractLabeledTerms(
  text: string,
): { product: string; price: string; tempi: string } | null {
  const makeRe = (label: string) =>
    new RegExp(
      `(?:^|\\n)\\s*(?:[•\\-*]\\s*)?(?:${label})\\s*[:：\\-–—]\\s*(.+?)(?=(?:\\n\\s*(?:[•\\-*]\\s*)?(?:Prodotto|Prezzo|Tempi|Condizioni)\\s*[:：\\-–—])|$)`,
      "is",
    );

  const productMatch = text.match(makeRe("Prodotto"));
  const priceMatch = text.match(makeRe("Prezzo"));
  const tempiMatch = text.match(makeRe("Tempi|Condizioni"));
  if (!productMatch?.[1] || !priceMatch?.[1] || !tempiMatch?.[1]) {
    return null;
  }
  return {
    product: productMatch[1].trim(),
    price: priceMatch[1].trim(),
    tempi: tempiMatch[1].trim(),
  };
}

export type ParseTermsResult =
  | { ok: true; product: string; amount: string; tempi: string }
  | { ok: false; reason: "format" | "price" | "short" };

/**
 * Una sola risposta = tre campi.
 * Accetta: tre righe, `prodotto / prezzo / tempi`, oppure etichette.
 */
export function parseTermsProposal(
  raw: string,
  asset: Deal["asset"],
): ParseTermsResult {
  const text = raw.trim();
  if (!text) return { ok: false, reason: "format" };

  let product: string | undefined;
  let priceRaw: string | undefined;
  let tempi: string | undefined;

  const labeled = extractLabeledTerms(text);
  if (labeled) {
    product = labeled.product;
    priceRaw = labeled.price;
    tempi = labeled.tempi;
  } else {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length >= 3) {
      product = lines[0];
      priceRaw = lines[1];
      tempi = lines.slice(2).join(" ").trim();
    } else {
      const parts = text
        .split(/\s*\/\s*/)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 3) {
        product = parts[0];
        priceRaw = parts[1];
        tempi = parts[2];
      }
    }
  }

  if (!product || !priceRaw || !tempi) {
    return { ok: false, reason: "format" };
  }

  product = normalizeTosField(product, "Prodotto");
  priceRaw = normalizeTosField(stripAssetSuffix(priceRaw, asset), "Prezzo");
  tempi = normalizeTosField(tempi, "Tempi");

  if (product.length < MIN_TOS_FIELD || tempi.length < MIN_TOS_FIELD) {
    return { ok: false, reason: "short" };
  }

  const amount = parseAmount(priceRaw);
  if (!amount) return { ok: false, reason: "price" };

  return { ok: true, product, amount, tempi };
}

/** Stati precedenti al deposito escrow (termini / wallet ancora aperti). */
export function isPreDepositSetup(status: Deal["status"]): boolean {
  return (
    status === "awaiting_tos" ||
    status === "awaiting_tos_confirm" ||
    status === "awaiting_amount" ||
    status === "awaiting_amount_confirm" ||
    status === "awaiting_seller_wallet" ||
    status === "awaiting_buyer_wallet"
  );
}

/** Aggiunge userId all'elenco visti nel gruppo (dedupe). */
export function rememberSeenUser(
  deal: Deal,
  userId: number,
): number[] | null {
  const prev = deal.seenGroupUserIds ?? [];
  if (prev.includes(userId)) return null;
  return [...prev, userId];
}

export function addUniqueVote(votes: number[], userId: number): number[] {
  if (votes.includes(userId)) return votes;
  return [...votes, userId];
}

export function counterpartRole(role: PartyRole): PartyRole {
  return role === "buyer" ? "seller" : "buyer";
}

/** Parte opposta al creatore (seller se creator=buyer e viceversa). */
export function counterpartParty(deal: Deal): {
  id?: number;
  username?: string;
  displayName?: string;
  role: PartyRole;
} {
  const role = counterpartRole(deal.creatorRole);
  if (role === "buyer") {
    return {
      id: deal.buyerId,
      username: deal.buyerUsername,
      displayName: deal.buyerDisplayName,
      role,
    };
  }
  return {
    id: deal.sellerId,
    username: deal.sellerUsername,
    displayName: deal.sellerDisplayName,
    role,
  };
}

/**
 * Mention Telegram: `@username` se c’è, altrimenti id in code, altrimenti fallback
 * (es. «controparte» solo se l’id non è ancora noto).
 */
export function mentionUser(
  username?: string,
  userId?: number,
  fallback = "controparte",
): string {
  if (username) return `@${username}`;
  if (userId != null) return `\`${userId}\``;
  return fallback;
}

export function mentionCounterpart(
  deal: Deal,
  fallback = "controparte",
): string {
  const cp = counterpartParty(deal);
  return mentionUser(cp.username, cp.id, fallback);
}

/** Parte del deal non ancora presente nei voti (per «aspetta @user»). */
export function mentionPendingVoter(
  deal: Deal,
  votes: number[],
  fallback = "controparte",
): string {
  if (deal.buyerId != null && !votes.includes(deal.buyerId)) {
    return mentionUser(deal.buyerUsername, deal.buyerId, fallback);
  }
  if (deal.sellerId != null && !votes.includes(deal.sellerId)) {
    return mentionUser(deal.sellerUsername, deal.sellerId, fallback);
  }
  return fallback;
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
