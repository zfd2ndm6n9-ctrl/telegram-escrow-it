import type { Deal, DmTermsStep, PartyRole } from "../types.js";
import { config } from "../config.js";

export function parseAmount(raw: string, maxDecimals = 9): string | null {
  const normalized = raw.trim().replace(",", ".");
  const dec = Math.max(0, Math.min(18, Math.floor(maxDecimals)));
  const re = new RegExp(`^\\d+(\\.\\d{1,${dec}})?$`);
  if (!re.test(normalized)) return null;
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

/** Numero → display IT (`5` / `12,50`). */
export function formatEuroNumber(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(".", ",");
}

/**
 * Split commerciale in € per messaggio di rilascio (UI only; fee on-chain invariata).
 * 95% seller · 5% fee (2.5/2.5 se collaboratore).
 */
export function commercialReleaseSplitEur(deal: Deal): {
  sellerEur: string;
  adminEur: string;
  collaboratorEur?: string;
  totalEur: string;
} | null {
  const raw = deal.priceEur?.trim();
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const total = Number(normalized);
  if (!Number.isFinite(total) || total <= 0) return null;

  const hasCollab = Boolean(deal.collaboratorWallet?.trim());
  const feeTotal = Math.round(total * 0.05 * 100) / 100;
  const seller = Math.round((total - feeTotal) * 100) / 100;
  if (!hasCollab) {
    return {
      totalEur: formatEuroNumber(total),
      sellerEur: formatEuroNumber(seller),
      adminEur: formatEuroNumber(feeTotal),
    };
  }
  const collab = Math.round(total * 0.025 * 100) / 100;
  const admin = Math.round((feeTotal - collab) * 100) / 100;
  return {
    totalEur: formatEuroNumber(total),
    sellerEur: formatEuroNumber(seller),
    adminEur: formatEuroNumber(admin),
    collaboratorEur: formatEuroNumber(collab),
  };
}

export function isParty(deal: Deal, userId: number): boolean {
  return deal.buyerId === userId || deal.sellerId === userId;
}

export function isAdminUser(userId: number): boolean {
  const ids = config.adminTelegramIds;
  if (!ids.length) return false;
  const s = String(userId);
  return ids.includes(s);
}

/**
 * Account supporto / helper MTProto (owner dei gruppi bot-created).
 * Stesso set di `ADMIN_TELEGRAM_ID(S)` — mai buyer/seller di un deal.
 */
export function isSupportHelperUser(userId: number): boolean {
  return isAdminUser(userId);
}

/**
 * Può essere bindato come buyer/seller (join / /avvia / messaggio).
 * Support/helper no, salvo se è già parte o creator del deal (edge: admin
 * che apre un deal in proprio — lo slot creator è già assegnato a create).
 */
export function canBindAsDealParty(deal: Deal, userId: number): boolean {
  if (isParty(deal, userId) || userId === deal.creatorId) return true;
  if (isSupportHelperUser(userId)) return false;
  return true;
}

/**
 * Force payout admin (`/payseller` / `/refundbuyer`): solo `ADMIN_TELEGRAM_IDS`
 * e solo se il deal è in `disputed` (audit: force OK in disputa; dual-confirm
 * resta il path normale fuori disputa).
 */
export function canAdminForcePayout(deal: Deal, userId: number): boolean {
  return deal.status === "disputed" && isAdminUser(userId);
}

/**
 * Solo il seller può segnare «Consegnato».
 * Admin di supporto (terzo) sì; buyer anche se admin → no (mai avanzare).
 */
export function canMarkShipped(deal: Deal, userId: number): boolean {
  if (deal.sellerId != null && userId === deal.sellerId) return true;
  if (!isAdminUser(userId)) return false;
  // Admin-parte buyer non deve bypassare il gate consegna.
  if (deal.buyerId != null && userId === deal.buyerId) return false;
  // Terzo admin (non buyer/seller): ok se lo slot seller è noto.
  return deal.sellerId != null;
}

/**
 * Solo il buyer avvia «Paga» / self-confirm release.
 * Party-only: niente proxy admin (A3 — force payout solo in `disputed`).
 * Seller anche se admin → false.
 */
export function canStartBuyerPay(deal: Deal, userId: number): boolean {
  return deal.buyerId != null && userId === deal.buyerId;
}

/**
 * Solo il buyer avvia «Chiedi il rimborso» / self-confirm refund.
 * Seller non può aprire il rimborso (solo Disputa / Altre info);
 * può confermare il 2° voto se il buyer ha già avviato (`canConfirmRefund`).
 * Party-only: niente proxy admin (A3).
 */
export function canStartRefund(deal: Deal, userId: number): boolean {
  return deal.buyerId != null && userId === deal.buyerId;
}

/**
 * Solo il seller conferma il 2/2 rilascio («Confermo»).
 * Party-only: buyer anche se admin → false (A3).
 */
export function canConfirmSellerPay(deal: Deal, userId: number): boolean {
  return deal.sellerId != null && userId === deal.sellerId;
}

/**
 * Secondo voto dual-confirm (release o refund): solo la parte ancora in attesa.
 * Mai admin proxy — evita che buyer-admin casti il voto seller (bug post-#62).
 */
export function canConfirmPendingVote(
  deal: Deal,
  votes: number[],
  userId: number,
): boolean {
  const expected = pendingVoterId(deal, votes);
  return expected != null && userId === expected;
}

/** Alias: 2° voto rimborso (`confirm_refund`). */
export function canConfirmRefund(deal: Deal, userId: number): boolean {
  return canConfirmPendingVote(deal, deal.refundVotes, userId);
}

/**
 * Annulla 1/2 (`cancel_confirm_*`): entrambe le parti possono abortire.
 * Terzi no. Admin terzo: sì (supporto; non è un voto).
 */
export function canCancelDualConfirm(deal: Deal, userId: number): boolean {
  if (isParty(deal, userId)) return true;
  return isAdminUser(userId);
}

/**
 * Turno wallet seller/buyer: solo la parte attesa.
 * Niente admin-as-other-party (allinea A3 sui path sensibili).
 */
export function canSetWalletNow(deal: Deal, userId: number): boolean {
  if (deal.status === "awaiting_seller_wallet") {
    return deal.sellerId != null && userId === deal.sellerId;
  }
  if (deal.status === "awaiting_buyer_wallet") {
    return deal.buyerId != null && userId === deal.buyerId;
  }
  return false;
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

/**
 * Target crypto lockato per deposito (stringa decimale).
 * Dopo Accetto/`amountConfirmedAt` non si ricalcola da FX live.
 * `null` se non ancora fissato.
 */
export function lockedCryptoAmount(deal: Deal): string | null {
  if (!amountConfirmed(deal)) return null;
  const maxDec =
    deal.asset === "LTC" ? 8 : deal.asset === "ETH" ? 18 : 9;
  return parseAmount(deal.amount, maxDec) ? deal.amount : null;
}

/** @deprecated alias — usa `lockedCryptoAmount`. */
export function lockedSolAmount(deal: Deal): string | null {
  return lockedCryptoAmount(deal);
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

export type TermsFieldLabel = "Prodotto" | "Prezzo" | "Condizioni";

/** Normalizza un campo termini strutturato prima del persist. */
export function normalizeTosField(
  raw: string,
  label: TermsFieldLabel,
): string {
  let current = stripRepeatedLabel(raw, label);
  if (label === "Condizioni") {
    current = stripRepeatedLabel(current, "Note");
    // Legacy: input ancora etichettato «Tempi»
    current = stripRepeatedLabel(current, "Tempi");
  }
  if (label === "Prezzo") {
    current = stripRepeatedLabel(current, "Price");
  }
  if (label === "Prodotto") {
    current = stripRepeatedLabel(current, "Prodotto/servizio");
    current = stripRepeatedLabel(current, "Product");
  }
  return current;
}

/** Lunghezza minima per Prodotto / Condizioni. */
export const MIN_TOS_FIELD = 2;

export type EssentialTermsField = "product" | "price" | "conditions";

/** Prodotto + Prezzo € + Condizioni pronti per Accetto. */
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
  if (!deal.tosConditions) missing.push("conditions");
  return missing;
}

/** Prossimo step del wizard DM (null = completo). */
export function nextDmTermsStep(deal: Deal): DmTermsStep | null {
  if (!deal.tosProduct) return "product";
  if (!deal.priceEur) return "price";
  if (!deal.tosConditions) return "conditions";
  return null;
}

/**
 * Elenco puntato fisso Prodotto/servizio / Prezzo € / Condizioni.
 * Campi vuoti → `—` (card sempre completa).
 */
export function formatTosBullets(deal: Deal): string {
  const product = deal.tosProduct
    ? escMd(
        stripRepeatedLabel(
          stripRepeatedLabel(deal.tosProduct, "Prodotto/servizio"),
          "Prodotto",
        ),
      )
    : "—";
  const price = deal.priceEur
    ? escMd(formatEuroPrice(deal.priceEur))
    : "—";
  // Condizioni in tosConditions; fallback legacy tosNotes se presente
  const conditionsRaw = deal.tosConditions
    ? stripRepeatedLabel(
        stripRepeatedLabel(deal.tosConditions, "Condizioni"),
        "Tempi",
      )
    : deal.tosNotes
      ? stripRepeatedLabel(deal.tosNotes, "Condizioni")
      : "";
  const conditions = conditionsRaw ? escMd(conditionsRaw) : "—";
  return (
    `• Prodotto/servizio: ${product}\n` +
    `• Prezzo: ${price}\n` +
    `• Condizioni: ${conditions}`
  );
}

/** Compone tosText persistito dall'elenco puntato. */
export function composeTosText(
  product: string,
  priceEur: string,
  conditions: string,
): string {
  const p = normalizeTosField(product, "Prodotto");
  const c = normalizeTosField(conditions, "Condizioni");
  return [
    `• Prodotto/servizio: ${p}`,
    `• Prezzo: ${formatEuroPrice(priceEur)}`,
    `• Condizioni: ${c}`,
  ].join("\n");
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
 * Escape `_` e altri char Markdown legacy così `@foo_bar` non spezza parse_mode.
 */
export function mentionUser(
  username?: string,
  userId?: number,
  fallback = "controparte",
): string {
  if (username) return `@${escMd(username)}`;
  if (userId != null) return `\`${userId}\``;
  return fallback;
}

/**
 * Chi ha proposto (o sta compilando) i termini.
 * Nuovo flusso: opener / ultimo «Proponi i ToS».
 * Legacy senza `tosProposedBy`: seller se termini pronti, altrimenti creator.
 */
export function termsProposerId(deal: Deal): number | undefined {
  if (deal.tosProposedBy != null) return deal.tosProposedBy;
  if (termsReadyForConfirm(deal) && deal.sellerId != null) {
    return deal.sellerId;
  }
  return deal.creatorId;
}

export function isTermsProposer(deal: Deal, userId: number): boolean {
  return termsProposerId(deal) === userId;
}

/** Controparte rispetto al proponente termini (può Accetta / Proponi). */
export function termsCounterpartId(deal: Deal): number | undefined {
  const proposer = termsProposerId(deal);
  if (proposer == null) return undefined;
  if (deal.buyerId != null && deal.sellerId != null) {
    if (proposer === deal.buyerId) return deal.sellerId;
    if (proposer === deal.sellerId) return deal.buyerId;
  }
  // Ruoli non entrambi bound: l'altra parte è chi non è creator se proposer=creator
  if (proposer === deal.creatorId) {
    return deal.creatorRole === "buyer" ? deal.sellerId : deal.buyerId;
  }
  return deal.creatorId;
}

export function mentionTermsProposer(
  deal: Deal,
  fallback = "proponente",
): string {
  const id = termsProposerId(deal);
  if (id == null) return fallback;
  if (id === deal.buyerId) {
    return mentionUser(deal.buyerUsername, deal.buyerId, fallback);
  }
  if (id === deal.sellerId) {
    return mentionUser(deal.sellerUsername, deal.sellerId, fallback);
  }
  return mentionUser(deal.creatorUsername, deal.creatorId, fallback);
}

/** Azzera campi termini + lock crypto (nuova proposta). */
export function blankTermsPatch(
  proposerId: number,
  opts?: { inGroup?: boolean },
): Partial<Deal> {
  return {
    tosProposedBy: proposerId,
    tosProduct: undefined,
    priceEur: undefined,
    tosConditions: undefined,
    tosText: undefined,
    tosNotes: undefined,
    tosAcceptedAt: undefined,
    amount: "",
    amountConfirmedAt: undefined,
    amountVotes: [],
    dmTermsSummaryMessageId: undefined,
    dmTermsPromptMessageId: undefined,
    groupTermsPromptMessageId: undefined,
    termsWizardInGroup: opts?.inGroup === true ? true : undefined,
  };
}

export function mentionCounterpart(
  deal: Deal,
  fallback = "controparte",
): string {
  const cp = counterpartParty(deal);
  return mentionUser(cp.username, cp.id, fallback);
}

/** Ruolo della parte non ancora presente nei voti (dual-confirm 1/2). */
export function pendingVoterRole(
  deal: Deal,
  votes: number[],
): PartyRole | null {
  if (deal.buyerId != null && !votes.includes(deal.buyerId)) return "buyer";
  if (deal.sellerId != null && !votes.includes(deal.sellerId)) return "seller";
  return null;
}

/** Telegram id della parte ancora da votare, o null se entrambe hanno votato. */
export function pendingVoterId(deal: Deal, votes: number[]): number | null {
  const role = pendingVoterRole(deal, votes);
  if (role === "buyer") return deal.buyerId ?? null;
  if (role === "seller") return deal.sellerId ?? null;
  return null;
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

/** True se il buyer ha già espresso il voto di release (buyer-first). */
export function buyerHasReleaseVote(deal: Deal): boolean {
  return deal.buyerId != null && deal.releaseVotes.includes(deal.buyerId);
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

  // Support/helper (owner gruppo MTProto): mai riempire uno slot vuoto.
  // Solo refresh se già parte (blocco sopra). Creator settato a create().
  if (isSupportHelperUser(userId)) {
    return null;
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
