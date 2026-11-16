import type { Api } from "grammy";
import type { Deal, DmTermsStep } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  composeTosText,
  MIN_TOS_FIELD,
  nextDmTermsStep,
  normalizeTosField,
  parseEuroPrice,
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

/** Deal seller incompleto (wizard DM attivo o da avviare). */
export function findOpenSellerTermsDeal(
  store: DealStore,
  sellerId: number,
): Deal | undefined {
  return store
    .listForUser(sellerId)
    .filter(
      (d) =>
        d.sellerId === sellerId &&
        !tosAccepted(d) &&
        !termsReadyForConfirm(d) &&
        d.status !== "cancelled" &&
        (d.status === "awaiting_group" ||
          d.status === "awaiting_bot_admin" ||
          d.status === "awaiting_counterpart" ||
          d.status === "awaiting_tos" ||
          d.status === "awaiting_tos_confirm"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Upsert del riepilogo vivente in DM seller. */
export async function upsertDmTermsSummary(
  api: Api,
  store: DealStore,
  deal: Deal,
  sellerChatId: number,
): Promise<Deal> {
  const text = it.dmTermsSummary(deal);
  const msgId = deal.dmTermsSummaryMessageId;

  if (msgId != null) {
    try {
      await api.editMessageText(sellerChatId, msgId, text, {
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
    const msg = await api.sendMessage(sellerChatId, text, {
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
  sellerChatId: number,
): Promise<Deal> {
  if (deal.dmTermsPromptMessageId != null) {
    await deleteMessageSafe(api, sellerChatId, deal.dmTermsPromptMessageId);
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
  sellerChatId: number,
  step: DmTermsStep,
): Promise<Deal> {
  let current = await clearDmPrompt(api, store, deal, sellerChatId);
  current = await upsertDmTermsSummary(api, store, current, sellerChatId);

  try {
    const msg = await api.sendMessage(
      sellerChatId,
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

export type StartSellerTermsResult =
  | { ok: true; deal: Deal; alreadyReady: boolean }
  | { ok: false; deal: Deal; reason: "no_seller" | "dm_blocked" };

/**
 * Avvia (o riprende) il wizard termini in DM al seller.
 * Best-effort: se il seller non ha /start, fallisce con dm_blocked.
 */
export async function startSellerTermsWizard(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<StartSellerTermsResult> {
  if (deal.sellerId == null) {
    return { ok: false, deal, reason: "no_seller" };
  }
  if (tosAccepted(deal)) {
    return { ok: true, deal, alreadyReady: true };
  }
  if (termsReadyForConfirm(deal)) {
    return { ok: true, deal, alreadyReady: true };
  }

  const step = nextDmTermsStep(deal) ?? "product";
  const sellerChatId = deal.sellerId;

  try {
    // Probe: se non può scrivere, Telegram lancia
    let current = await upsertDmTermsSummary(api, store, deal, sellerChatId);
    current = await askDmTermsStep(api, store, current, sellerChatId, step);
    return { ok: true, deal: current, alreadyReady: false };
  } catch (err) {
    console.warn(
      `startSellerTermsWizard deal #${deal.id} seller ${sellerChatId}:`,
      err,
    );
    return { ok: false, deal, reason: "dm_blocked" };
  }
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
 * Applica la risposta del seller a uno step, igiene messaggi, aggiorna summary.
 * Se completo: compose tosText e status awaiting_tos_confirm (se già in gruppo).
 */
export async function applySellerTermsAnswer(
  api: Api,
  store: DealStore,
  deal: Deal,
  sellerChatId: number,
  userId: number,
  step: DmTermsStep,
  rawText: string,
  userMessageId?: number,
): Promise<ApplyTermsAnswerResult> {
  if (deal.sellerId !== userId) {
    return { ok: false, deal, reason: "wrong_user" };
  }

  const text = rawText.trim();
  if (!text) {
    return { ok: false, deal, reason: "empty" };
  }

  let patch: Partial<Deal> = {};

  if (step === "product") {
    const product = normalizeTosField(text, "Prodotto");
    if (product.length < MIN_TOS_FIELD) {
      return { ok: false, deal, reason: "short" };
    }
    patch = { tosProduct: product };
  } else if (step === "price") {
    const priceRaw = normalizeTosField(text, "Prezzo");
    const eur = parseEuroPrice(priceRaw);
    if (!eur) {
      return { ok: false, deal, reason: "price" };
    }
    patch = { priceEur: eur };
  } else {
    const conditions = normalizeTosField(text, "Condizioni");
    if (conditions.length < MIN_TOS_FIELD) {
      return { ok: false, deal, reason: "short" };
    }
    patch = { tosConditions: conditions };
  }

  let current =
    store.update(deal.id, {
      ...patch,
      tosAcceptedAt: undefined,
      amountConfirmedAt: undefined,
      amountVotes: [],
    }) ?? deal;

  // Igiene: cancella prompt bot + risposta utente (best-effort in DM)
  current = await clearDmPrompt(api, store, current, sellerChatId);
  if (userMessageId != null) {
    await deleteMessageSafe(api, sellerChatId, userMessageId);
  }

  current = await upsertDmTermsSummary(api, store, current, sellerChatId);

  const next = nextDmTermsStep(current);
  if (next) {
    current = await askDmTermsStep(api, store, current, sellerChatId, next);
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
      tosAcceptedAt: undefined,
      status: inGroup ? "awaiting_tos_confirm" : current.status,
      dmTermsPromptMessageId: undefined,
    }) ?? current;

  try {
    await api.sendMessage(sellerChatId, it.dmTermsComplete(current), {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.warn(`dmTermsComplete notify #${current.id} failed:`, err);
  }

  return { ok: true, deal: current, done: true };
}
