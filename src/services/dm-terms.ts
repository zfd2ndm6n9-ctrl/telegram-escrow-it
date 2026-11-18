import type { Api } from "grammy";
import type { Deal, DmTermsStep } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  blankTermsPatch,
  composeTosText,
  mentionTermsProposer,
  MIN_TOS_FIELD,
  nextDmTermsStep,
  normalizeTosField,
  parseEuroPrice,
  termsProposerId,
  termsReadyForConfirm,
  tosAccepted,
} from "./deal-logic.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

function isNotModifiedError(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "description" in err
      ? String((err as { description?: string }).description ?? "")
      : err instanceof Error
        ? err.message
        : String(err);
  return /message is not modified/i.test(msg);
}

/**
 * Deal con wizard termini incompleto per `userId` (proponente corrente).
 */
export function findOpenTermsDeal(
  store: DealStore,
  userId: number,
): Deal | undefined {
  return store
    .listForUser(userId)
    .filter((d) => {
      if (tosAccepted(d) || termsReadyForConfirm(d)) return false;
      if (d.status === "cancelled") return false;
      const openStatus =
        d.status === "awaiting_group" ||
        d.status === "awaiting_bot_admin" ||
        d.status === "awaiting_counterpart" ||
        d.status === "awaiting_tos" ||
        d.status === "awaiting_tos_confirm";
      if (!openStatus) return false;
      const proposer = termsProposerId(d);
      return proposer === userId;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** @deprecated alias → findOpenTermsDeal */
export const findOpenSellerTermsDeal = findOpenTermsDeal;

/**
 * Cancella riepilogo + prompt termini in DM (fine wizard → istruzioni gruppo, o annulla).
 */
export async function clearDmTermsUi(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerChatId: number,
): Promise<Deal> {
  if (deal.dmTermsPromptMessageId != null) {
    await deleteMessageSafe(api, proposerChatId, deal.dmTermsPromptMessageId);
  }
  if (deal.dmTermsSummaryMessageId != null) {
    await deleteMessageSafe(api, proposerChatId, deal.dmTermsSummaryMessageId);
  }
  if (
    deal.dmTermsPromptMessageId == null &&
    deal.dmTermsSummaryMessageId == null
  ) {
    return deal;
  }
  return (
    store.update(deal.id, {
      dmTermsPromptMessageId: undefined,
      dmTermsSummaryMessageId: undefined,
    }) ?? deal
  );
}

/** Upsert del riepilogo vivente in DM del proponente. */
export async function upsertDmTermsSummary(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerChatId: number,
): Promise<Deal> {
  const text = it.dmTermsSummary(deal);
  const msgId = deal.dmTermsSummaryMessageId;

  if (msgId != null) {
    try {
      await api.editMessageText(proposerChatId, msgId, text, {
        parse_mode: "Markdown",
      });
      return deal;
    } catch (err) {
      if (isNotModifiedError(err)) return deal;
      console.warn(
        `edit DM terms summary ${msgId} for deal #${deal.id} failed, re-sending:`,
        err,
      );
    }
  }

  try {
    const msg = await api.sendMessage(proposerChatId, text, {
      parse_mode: "Markdown",
    });
    return (
      store.update(deal.id, { dmTermsSummaryMessageId: msg.message_id }) ?? deal
    );
  } catch (err) {
    console.warn(`send DM terms summary for deal #${deal.id} failed:`, err);
    return deal;
  }
}

async function clearDmPrompt(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerChatId: number,
): Promise<Deal> {
  if (deal.dmTermsPromptMessageId != null) {
    await deleteMessageSafe(api, proposerChatId, deal.dmTermsPromptMessageId);
  }
  return (
    store.update(deal.id, { dmTermsPromptMessageId: undefined }) ?? deal
  );
}

/** Invia (o sostituisce) la domanda corrente; cancella il prompt precedente. */
export async function askDmTermsStep(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerChatId: number,
  step: DmTermsStep,
): Promise<Deal> {
  let current = await clearDmPrompt(api, store, deal, proposerChatId);
  current = await upsertDmTermsSummary(api, store, current, proposerChatId);

  try {
    const msg = await api.sendMessage(
      proposerChatId,
      it.dmTermsAsk(step, current),
      { parse_mode: "Markdown" },
    );
    return (
      store.update(current.id, { dmTermsPromptMessageId: msg.message_id }) ??
      current
    );
  } catch (err) {
    console.warn(
      `ask DM terms step ${step} for deal #${deal.id} failed:`,
      err,
    );
    return current;
  }
}

export type StartTermsResult =
  | { ok: true; deal: Deal; alreadyReady: boolean }
  | { ok: false; deal: Deal; reason: "no_proposer" | "dm_blocked" };

/**
 * Avvia (o riprende) il wizard termini in DM al proponente.
 * Best-effort: se non ha /start, fallisce con dm_blocked.
 */
export async function startTermsWizard(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerId?: number,
): Promise<StartTermsResult> {
  const who = proposerId ?? termsProposerId(deal) ?? deal.creatorId;
  if (who == null) {
    return { ok: false, deal, reason: "no_proposer" };
  }
  if (tosAccepted(deal)) {
    return { ok: true, deal, alreadyReady: true };
  }
  if (termsReadyForConfirm(deal) && termsProposerId(deal) === who) {
    return { ok: true, deal, alreadyReady: true };
  }

  let current = await clearGroupTermsPrompt(api, store, deal);
  current =
    store.update(current.id, {
      tosProposedBy: who,
      termsWizardInGroup: undefined,
    }) ?? current;
  const step = nextDmTermsStep(current) ?? "product";

  try {
    let next = await upsertDmTermsSummary(api, store, current, who);
    next = await askDmTermsStep(api, store, next, who, step);
    return { ok: true, deal: next, alreadyReady: false };
  } catch (err) {
    console.warn(
      `startTermsWizard deal #${deal.id} proposer ${who}:`,
      err,
    );
    return { ok: false, deal: current, reason: "dm_blocked" };
  }
}

/** @deprecated alias → startTermsWizard (proponente = seller legacy) */
export async function startSellerTermsWizard(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<StartTermsResult> {
  return startTermsWizard(api, store, deal, deal.sellerId ?? deal.creatorId);
}

async function clearGroupTermsPrompt(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId != null && deal.groupTermsPromptMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.groupTermsPromptMessageId);
  }
  if (deal.groupTermsPromptMessageId == null) return deal;
  return (
    store.update(deal.id, { groupTermsPromptMessageId: undefined }) ?? deal
  );
}

/** Domanda corrente nel gruppo; cancella il prompt precedente. */
export async function askGroupTermsStep(
  api: Api,
  store: DealStore,
  deal: Deal,
  step: DmTermsStep,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) return deal;

  let current = await clearGroupTermsPrompt(api, store, deal);
  const who = mentionTermsProposer(current, "proponente");
  try {
    const msg = await api.sendMessage(
      chatId,
      `${who}: ${it.dmTermsAsk(step, current)}`,
      { parse_mode: "Markdown" },
    );
    return (
      store.update(current.id, {
        groupTermsPromptMessageId: msg.message_id,
        termsWizardInGroup: true,
      }) ?? current
    );
  } catch (err) {
    console.warn(
      `ask group terms step ${step} for deal #${deal.id} failed:`,
      err,
    );
    return current;
  }
}

/**
 * Nuova proposta in gruppo: azzera termini, card, 3 domande una per una.
 * (L'opener /crea resta in DM via `startTermsWizard`.)
 */
export async function startProposeTermsWizard(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerId: number,
): Promise<StartTermsResult> {
  // Best-effort: cancella riepilogo/prompt DM del proponente precedente
  const prev = termsProposerId(deal);
  if (
    prev != null &&
    (deal.dmTermsSummaryMessageId != null ||
      deal.dmTermsPromptMessageId != null)
  ) {
    if (deal.dmTermsPromptMessageId != null) {
      await deleteMessageSafe(api, prev, deal.dmTermsPromptMessageId);
    }
    if (deal.dmTermsSummaryMessageId != null) {
      await deleteMessageSafe(api, prev, deal.dmTermsSummaryMessageId);
    }
  }

  let cleared = await clearGroupTermsPrompt(api, store, deal);

  if (cleared.groupChatId == null) {
    // Senza gruppo: fallback DM (non dovrebbe capitare da Proponi in gruppo)
    cleared =
      store.update(cleared.id, {
        ...blankTermsPatch(proposerId),
      }) ?? cleared;
    return startTermsWizard(api, store, cleared, proposerId);
  }

  cleared =
    store.update(cleared.id, {
      ...blankTermsPatch(proposerId, { inGroup: true }),
      status: "awaiting_tos",
    }) ?? cleared;

  // Caller aggiorna la card; qui solo la prima domanda nel gruppo.
  const step = nextDmTermsStep(cleared) ?? "product";
  cleared = await askGroupTermsStep(api, store, cleared, step);
  return { ok: true, deal: cleared, alreadyReady: false };
}

export type ApplyTermsAnswerResult =
  | {
      ok: true;
      deal: Deal;
      done: boolean;
      nextStep?: DmTermsStep;
    }
  | {
      ok: false;
      deal: Deal;
      reason: "short" | "price" | "empty" | "wrong_user";
    };

/**
 * Applica la risposta del proponente a uno step, igiene messaggi, aggiorna summary.
 * Se completo: compose tosText e status awaiting_tos_confirm (se già in gruppo).
 */
export async function applyTermsAnswer(
  api: Api,
  store: DealStore,
  deal: Deal,
  proposerChatId: number,
  userId: number,
  step: DmTermsStep,
  rawText: string,
  userMessageId?: number,
): Promise<ApplyTermsAnswerResult> {
  const proposer = termsProposerId(deal) ?? deal.tosProposedBy;
  if (proposer != null && proposer !== userId) {
    return { ok: false, deal, reason: "wrong_user" };
  }
  // Prima risposta: marca proponente se assente
  let working =
    deal.tosProposedBy == null
      ? (store.update(deal.id, { tosProposedBy: userId }) ?? deal)
      : deal;
  if (working.tosProposedBy !== userId) {
    return { ok: false, deal: working, reason: "wrong_user" };
  }

  const text = rawText.trim();
  if (!text) {
    return { ok: false, deal: working, reason: "empty" };
  }

  let patch: Partial<Deal> = {};

  if (step === "product") {
    const product = normalizeTosField(text, "Prodotto");
    if (product.length < MIN_TOS_FIELD) {
      return { ok: false, deal: working, reason: "short" };
    }
    patch = { tosProduct: product };
  } else if (step === "price") {
    const priceRaw = normalizeTosField(text, "Prezzo");
    const eur = parseEuroPrice(priceRaw);
    if (!eur) {
      return { ok: false, deal: working, reason: "price" };
    }
    patch = { priceEur: eur };
  } else {
    const conditions = normalizeTosField(text, "Condizioni");
    if (conditions.length < MIN_TOS_FIELD) {
      return { ok: false, deal: working, reason: "short" };
    }
    patch = { tosConditions: conditions };
  }

  // Pre-Accetto: azzera lock crypto così Accetto rifà €→SOL sul prezzo finale.
  let current =
    store.update(working.id, {
      ...patch,
      tosProposedBy: userId,
      tosAcceptedAt: undefined,
      amountConfirmedAt: undefined,
      amount: "",
      amountVotes: [],
    }) ?? working;

  // Igiene: cancella prompt bot + risposta utente (best-effort in DM)
  current = await clearDmPrompt(api, store, current, proposerChatId);
  if (userMessageId != null) {
    await deleteMessageSafe(api, proposerChatId, userMessageId);
  }

  current = await upsertDmTermsSummary(api, store, current, proposerChatId);

  const next = nextDmTermsStep(current);
  if (next) {
    current = await askDmTermsStep(api, store, current, proposerChatId, next);
    return { ok: true, deal: current, done: false, nextStep: next };
  }

  // Completo
  const tosText = composeTosText(
    current.tosProduct!,
    current.priceEur!,
    current.tosConditions!,
  );

  const inGroup =
    current.groupChatId != null &&
    (current.status === "awaiting_tos" ||
      current.status === "awaiting_tos_confirm" ||
      current.status === "awaiting_counterpart");

  current =
    store.update(current.id, {
      tosText,
      tosProposedBy: userId,
      tosAcceptedAt: undefined,
      status: inGroup ? "awaiting_tos_confirm" : current.status,
      dmTermsPromptMessageId: undefined,
    }) ?? current;

  // Nessun notify qui: il caller decide (evita overlap «Termini salvati» + «Deal pronto»).
  return { ok: true, deal: current, done: true };
}

/** @deprecated alias → applyTermsAnswer */
export const applySellerTermsAnswer = applyTermsAnswer;

/**
 * Applica risposta termini nel gruppo (Proponi i ToS).
 * Igiene: cancella domanda bot + risposta utente; aggiorna campi deal.
 * A fine wizard: status awaiting_tos_confirm (card/keyboard a cura del caller).
 */
export async function applyGroupTermsAnswer(
  api: Api,
  store: DealStore,
  deal: Deal,
  userId: number,
  step: DmTermsStep,
  rawText: string,
  userMessageId?: number,
): Promise<ApplyTermsAnswerResult> {
  const chatId = deal.groupChatId;
  if (chatId == null) {
    return { ok: false, deal, reason: "wrong_user" };
  }

  const proposer = termsProposerId(deal) ?? deal.tosProposedBy;
  if (proposer != null && proposer !== userId) {
    return { ok: false, deal, reason: "wrong_user" };
  }
  let working =
    deal.tosProposedBy == null
      ? (store.update(deal.id, {
          tosProposedBy: userId,
          termsWizardInGroup: true,
        }) ?? deal)
      : deal;
  if (working.tosProposedBy !== userId) {
    return { ok: false, deal: working, reason: "wrong_user" };
  }

  const text = rawText.trim();
  if (!text) {
    return { ok: false, deal: working, reason: "empty" };
  }

  let patch: Partial<Deal> = {};
  if (step === "product") {
    const product = normalizeTosField(text, "Prodotto");
    if (product.length < MIN_TOS_FIELD) {
      return { ok: false, deal: working, reason: "short" };
    }
    patch = { tosProduct: product };
  } else if (step === "price") {
    const priceRaw = normalizeTosField(text, "Prezzo");
    const eur = parseEuroPrice(priceRaw);
    if (!eur) {
      return { ok: false, deal: working, reason: "price" };
    }
    patch = { priceEur: eur };
  } else {
    const conditions = normalizeTosField(text, "Condizioni");
    if (conditions.length < MIN_TOS_FIELD) {
      return { ok: false, deal: working, reason: "short" };
    }
    patch = { tosConditions: conditions };
  }

  let current =
    store.update(working.id, {
      ...patch,
      tosProposedBy: userId,
      termsWizardInGroup: true,
      tosAcceptedAt: undefined,
      amountConfirmedAt: undefined,
      amount: "",
      amountVotes: [],
    }) ?? working;

  // Igiene gruppo: cancella prompt + risposta
  current = await clearGroupTermsPrompt(api, store, current);
  if (userMessageId != null) {
    await deleteMessageSafe(api, chatId, userMessageId);
  }

  const next = nextDmTermsStep(current);
  if (next) {
    current = await askGroupTermsStep(api, store, current, next);
    return { ok: true, deal: current, done: false, nextStep: next };
  }

  const tosText = composeTosText(
    current.tosProduct!,
    current.priceEur!,
    current.tosConditions!,
  );

  current =
    store.update(current.id, {
      tosText,
      tosProposedBy: userId,
      tosAcceptedAt: undefined,
      status: "awaiting_tos_confirm",
      termsWizardInGroup: undefined,
      groupTermsPromptMessageId: undefined,
    }) ?? current;

  return { ok: true, deal: current, done: true };
}
