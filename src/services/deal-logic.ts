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

/**
 * Prezzo commerciale EUR da testo libero.
 * Accetta: `5`, `5€`, `5 eur`, `€10`, `12,50`, `12.50`.
 * Restituisce forma display IT (`5`, `12,50`) senza simbolo.
 */
export function parseEuroPrice(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s
    .replace(/€/g, " ")
    .replace(/\b(?:eur|euro|euros)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Solo cifre / separatori decimali / migliaia
  s = s.replace(/\s/g, "");
  if (!s) return null;

  let normalized: string;
  let display: string;

  if (s.includes(",") && s.includes(".")) {
    // 1.234,56 (IT) oppure 1,234.56 (EN)
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      normalized = s.replace(/\./g, "").replace(",", ".");
      display = s.replace(/\./g, "");
    } else {
      normalized = s.replace(/,/g, "");
      const [intPart, frac = ""] = normalized.split(".");
      display = frac ? `${intPart},${frac}` : intPart;
    }
  } else if (s.includes(",")) {
    normalized = s.replace(",", ".");
    display = s;
  } else if (s.includes(".")) {
    normalized = s;
    const [intPart, frac = ""] = s.split(".");
    display = frac ? `${intPart},${frac}` : intPart;
  } else {
    normalized = s;
    display = s;
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Normalizza zeri inutili in display intero
  if (Number.isInteger(n)) return String(n);
  return display;
}

/** Display card: `5 €` / `12,50 €`. */
export function formatEuroPrice(priceEur: string): string {
  return `${priceEur.trim()} €`;
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

/** Importo crypto fissato (deposito on-chain). */
export function amountConfirmed(deal: Deal): boolean {
  return Boolean(deal.amount && deal.amountConfirmedAt);
}

/** Escape minimo per testo utente in Markdown legacy Telegram. */
export function escMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

/**
 * Toglie un eventuale prefisso etichetta ripetuto dall'input utente
 * (es. "prodotto: casa" → "casa", "prezzo 5" → "5").
 */
export function stripRepeatedLabel(value: string, label: string): string {
  const pattern = new RegExp(
    `^(?:[•\\-*]\\s*)?${label}(?:\\s*[:：\\-–—]\\s*|\\s+)`,
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

export type TermsFieldLabel =
  | "Prodotto"
  | "Prezzo"
  | "Tempi"
  | "Condizioni"
  | "Escrow"
  | "Importo";

/** Normalizza un campo termini strutturato prima del persist. */
export function normalizeTosField(
  raw: string,
  label: TermsFieldLabel,
): string {
  let current = stripRepeatedLabel(raw, label);
  // Alias legacy / IT
  if (label === "Tempi") {
    current = stripRepeatedLabel(current, "Condizioni");
  }
  if (label === "Condizioni") {
    current = stripRepeatedLabel(current, "Note");
  }
  if (label === "Escrow" || label === "Importo") {
    current = stripRepeatedLabel(current, "Deposito");
    current = stripRepeatedLabel(current, "Escrow");
    current = stripRepeatedLabel(current, "Importo");
  }
  return current;
}

/** Lunghezza minima per Prodotto / Tempi. */
export const MIN_TOS_FIELD = 2;

export type EssentialTermsField = "product" | "price" | "tempi";

/** Prodotto + Prezzo € + Tempi pronti per Accetto (Condizioni opzionale). */
export function termsReadyForConfirm(deal: Deal): boolean {
  return Boolean(
    deal.tosProduct &&
      deal.priceEur &&
      deal.tosConditions &&
      deal.tosText,
  );
}

export function missingEssentialTerms(deal: Deal): EssentialTermsField[] {
  const missing: EssentialTermsField[] = [];
  if (!deal.tosProduct) missing.push("product");
  if (!deal.priceEur) missing.push("price");
  if (!deal.tosConditions) missing.push("tempi");
  return missing;
}

/**
 * Elenco puntato fisso Prodotto / Prezzo € / Tempi / Condizioni.
 * Campi vuoti → `—` (card sempre completa).
 */
export function formatTosBullets(deal: Deal): string {
  const product = deal.tosProduct
    ? escMd(stripRepeatedLabel(deal.tosProduct, "Prodotto"))
    : "—";
  const price = deal.priceEur
    ? escMd(formatEuroPrice(deal.priceEur))
    : "—";
  const tempiRaw = deal.tosConditions
    ? stripRepeatedLabel(
        stripRepeatedLabel(deal.tosConditions, "Tempi"),
        "Condizioni",
      )
    : "";
  const tempi = tempiRaw ? escMd(tempiRaw) : "—";
  const notesRaw = deal.tosNotes
    ? stripRepeatedLabel(deal.tosNotes, "Condizioni")
    : "";
  const notes = notesRaw ? escMd(notesRaw) : "—";
  return (
    `• Prodotto: ${product}\n` +
    `• Prezzo: ${price}\n` +
    `• Tempi: ${tempi}\n` +
    `• Condizioni: ${notes}`
  );
}

/** Compone tosText persistito dall'elenco puntato. */
export function composeTosText(
  product: string,
  priceEur: string,
  tempi: string,
  notes?: string,
): string {
  const p = normalizeTosField(product, "Prodotto");
  const t = normalizeTosField(tempi, "Tempi");
  const n = notes?.trim()
    ? normalizeTosField(notes, "Condizioni")
    : "";
  const lines = [
    `• Prodotto: ${p}`,
    `• Prezzo: ${formatEuroPrice(priceEur)}`,
    `• Tempi: ${t}`,
    `• Condizioni: ${n || "—"}`,
  ];
  return lines.join("\n");
}

function stripAssetSuffix(raw: string, asset: string): string {
  return raw.replace(new RegExp(`\\s*${asset}\\s*$`, "i"), "").trim();
}

const LABEL_ALT =
  "Prodotto|Prezzo|Tempi|Condizioni|Note|Escrow|Importo|Deposito|Amount|Price|Product";

function labeledValue(text: string, labelAlt: string): string | undefined {
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:[•\\-*]\\s*)?(?:${labelAlt})(?:\\s*[:：\\-–—]\\s*|\\s+)(.+?)(?=(?:\\n\\s*(?:[•\\-*]\\s*)?(?:${LABEL_ALT})(?:\\s*[:：\\-–—]|\\s+))|$)`,
    "is",
  );
  const m = text.match(re);
  const v = m?.[1]?.trim();
  return v || undefined;
}

/** Estrae campi etichettati (best-effort, anche parziali). */
function extractLabeledTerms(text: string): {
  product?: string;
  price?: string;
  tempi?: string;
  notes?: string;
  escrow?: string;
} {
  return {
    product: labeledValue(text, "Prodotto|Product"),
    price: labeledValue(text, "Prezzo|Price"),
    tempi: labeledValue(text, "Tempi"),
    notes: labeledValue(text, "Condizioni|Note"),
    escrow: labeledValue(text, "Escrow|Importo|Deposito|Amount"),
  };
}

/** Cerca un importo crypto esplicitamente etichettato o con suffisso asset. */
export function extractCryptoAmount(
  text: string,
  asset: Deal["asset"],
): string | null {
  const labeled = labeledValue(text, "Escrow|Importo\\s*escrow|Deposito|Amount");
  if (labeled) {
    const cleaned = normalizeTosField(
      stripAssetSuffix(labeled, asset),
      "Escrow",
    );
    const amt = parseAmount(cleaned);
    if (amt) return amt;
  }

  const assetRe = new RegExp(
    `(?:^|[\\s:])(\\d+(?:[.,]\\d{1,9})?)\\s*${asset}\\b`,
    "i",
  );
  const m = text.match(assetRe);
  if (m?.[1]) {
    const amt = parseAmount(m[1]);
    if (amt) return amt;
  }

  const escrowInline = text.match(
    /\b(?:escrow|deposito)\s*[:：]?\s*(\d+(?:[.,]\d{1,9})?)/i,
  );
  if (escrowInline?.[1]) {
    const amt = parseAmount(escrowInline[1]);
    if (amt) return amt;
  }

  return null;
}

function looksLikePriceToken(token: string): boolean {
  return parseEuroPrice(token) != null;
}

export type ParsedTermsFields = {
  product?: string;
  priceEur?: string;
  tempi?: string;
  notes?: string;
  cryptoAmount?: string;
};

export type ParseTermsResult =
  | {
      ok: true;
      product: string;
      priceEur: string;
      tempi: string;
      notes?: string;
      cryptoAmount?: string;
    }
  | {
      ok: false;
      reason: "incomplete" | "price" | "short" | "empty";
      partial: ParsedTermsFields;
      missing: EssentialTermsField[];
    };

/**
 * Termini da messaggio libero (best-effort).
 * Etichette, righe, slash, keyword — senza formato obbligatorio.
 */
export function parseTermsProposal(
  raw: string,
  asset: Deal["asset"],
): ParseTermsResult {
  const text = raw.trim();
  if (!text) {
    return {
      ok: false,
      reason: "empty",
      partial: {},
      missing: ["product", "price", "tempi"],
    };
  }

  const partial: ParsedTermsFields = {};
  const labeled = extractLabeledTerms(text);

  if (labeled.product) {
    partial.product = normalizeTosField(labeled.product, "Prodotto");
  }
  if (labeled.price) {
    const priceRaw = normalizeTosField(
      stripAssetSuffix(labeled.price, asset),
      "Prezzo",
    );
    const eur = parseEuroPrice(priceRaw);
    if (eur) partial.priceEur = eur;
    else if (priceRaw) {
      // Prezzo presente ma non parseabile → errore dedicato
      return {
        ok: false,
        reason: "price",
        partial,
        missing: ["price"],
      };
    }
  }
  if (labeled.tempi) {
    partial.tempi = normalizeTosField(labeled.tempi, "Tempi");
  }
  if (labeled.notes) {
    partial.notes = normalizeTosField(labeled.notes, "Condizioni");
  }

  const cryptoFromLabel = extractCryptoAmount(text, asset);
  if (cryptoFromLabel) partial.cryptoAmount = cryptoFromLabel;

  // Se etichette incomplete: prova tre righe / slash / eur inline
  if (!partial.product || !partial.priceEur || !partial.tempi) {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (!partial.product || !partial.priceEur || !partial.tempi) {
      const isMetaLine = (line: string) =>
        /^(?:[•\-*]\s*)?(?:condizioni|note|escrow|deposito|importo)\b/i.test(
          line,
        );
      if (lines.length >= 3 && !labeled.product && !labeled.price && !labeled.tempi) {
        const p0 = normalizeTosField(lines[0], "Prodotto");
        const p1raw = normalizeTosField(
          stripAssetSuffix(lines[1], asset),
          "Prezzo",
        );
        const tempiLines = lines.slice(2).filter((l) => !isMetaLine(l));
        const p2 = normalizeTosField(tempiLines.join(" ").trim(), "Tempi");
        if (!partial.product && p0) partial.product = p0;
        if (!partial.priceEur) {
          const eur = parseEuroPrice(p1raw);
          if (eur) partial.priceEur = eur;
          else if (p1raw && looksLikePriceToken(p1raw) === false && /[a-zA-Zàèéìòù]/i.test(p1raw) && !/\d/.test(p1raw)) {
            // seconda riga non-prezzo: ignora
          } else if (p1raw && /\d/.test(p1raw) && !parseEuroPrice(p1raw)) {
            return {
              ok: false,
              reason: "price",
              partial,
              missing: ["price"],
            };
          }
        }
        if (!partial.tempi && p2) partial.tempi = p2;
      } else {
        const parts = text
          .split(/\s*\/\s*/)
          .map((p) => p.trim())
          .filter(Boolean);
        if (
          parts.length === 3 &&
          !labeled.product &&
          !labeled.price &&
          !labeled.tempi
        ) {
          if (!partial.product) {
            partial.product = normalizeTosField(parts[0], "Prodotto");
          }
          if (!partial.priceEur) {
            const eur = parseEuroPrice(
              normalizeTosField(stripAssetSuffix(parts[1], asset), "Prezzo"),
            );
            if (eur) partial.priceEur = eur;
          }
          if (!partial.tempi) {
            partial.tempi = normalizeTosField(parts[2], "Tempi");
          }
        }
      }
    }

    // Righe etichettate miste (es. "prezzo 5" senza altri label colon)
    if (lines.length >= 1) {
      for (const line of lines) {
        const low = line.toLowerCase();
        if (!partial.product && /^(?:[•\-*]\s*)?prodotto\b/i.test(line)) {
          partial.product = normalizeTosField(line, "Prodotto");
        } else if (!partial.priceEur && /^(?:[•\-*]\s*)?prezzo\b/i.test(line)) {
          const priceRaw = normalizeTosField(
            stripAssetSuffix(line, asset),
            "Prezzo",
          );
          const eur = parseEuroPrice(priceRaw);
          if (eur) partial.priceEur = eur;
          else if (priceRaw) {
            return {
              ok: false,
              reason: "price",
              partial,
              missing: ["price"],
            };
          }
        } else if (!partial.tempi && /^(?:[•\-*]\s*)?tempi\b/i.test(line)) {
          partial.tempi = normalizeTosField(line, "Tempi");
        } else if (
          !partial.notes &&
          /^(?:[•\-*]\s*)?(?:condizioni|note)\b/i.test(line)
        ) {
          partial.notes = normalizeTosField(line, "Condizioni");
        } else if (
          !partial.cryptoAmount &&
          /^(?:[•\-*]\s*)?(?:escrow|deposito|importo)\b/i.test(line)
        ) {
          const cleaned = normalizeTosField(
            stripAssetSuffix(line, asset),
            "Escrow",
          );
          const amt = parseAmount(cleaned);
          if (amt) partial.cryptoAmount = amt;
        } else if (
          !partial.priceEur &&
          (low.includes("€") || /\b(?:eur|euro)\b/i.test(line))
        ) {
          const eur = parseEuroPrice(line);
          if (eur) partial.priceEur = eur;
        }
      }
    }

    // Unica riga con prezzo € riconoscibile + resto testo
    if (!partial.priceEur) {
      const eurInline = text.match(
        /(?:€\s*)(\d+(?:[.,]\d{1,2})?)|(?:^|[^\d])(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)\b/i,
      );
      if (eurInline) {
        const token = eurInline[1] || eurInline[2];
        const eur = parseEuroPrice(token);
        if (eur) partial.priceEur = eur;
      }
    }
  }

  const missing: EssentialTermsField[] = [];
  if (!partial.product) missing.push("product");
  if (!partial.priceEur) missing.push("price");
  if (!partial.tempi) missing.push("tempi");

  if (missing.length > 0) {
    return { ok: false, reason: "incomplete", partial, missing };
  }

  if (
    partial.product!.length < MIN_TOS_FIELD ||
    partial.tempi!.length < MIN_TOS_FIELD
  ) {
    return { ok: false, reason: "short", partial, missing: [] };
  }

  return {
    ok: true,
    product: partial.product!,
    priceEur: partial.priceEur!,
    tempi: partial.tempi!,
    notes: partial.notes,
    cryptoAmount: partial.cryptoAmount,
  };
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
