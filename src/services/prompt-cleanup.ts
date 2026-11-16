import type { Api, InlineKeyboard } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";

type PromptExtra = {
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  reply_markup?: InlineKeyboard;
};

function promptIds(deal: Deal): number[] {
  return deal.botPromptIds ?? [];
}

function keptMessageIds(deal: Deal): Set<number> {
  const keep = new Set<number>();
  if (deal.setupMessageId != null) {
    keep.add(deal.setupMessageId);
  }
  if (deal.tosAcceptedMessageId != null) {
    keep.add(deal.tosAcceptedMessageId);
  }
  return keep;
}

export async function deleteMessageSafe(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    await api.deleteMessage(chatId, messageId);
  } catch {
    // già eliminato o senza permesso
  }
}

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
 * Elimina i prompt obsoleti del bot (non i messaggi utente).
 * Tollerante: messaggio già cancellato / permessi mancanti → skip.
 * Non tocca i ToS accettati (`tosAcceptedMessageId`).
 */
export async function clearBotPrompts(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  const keep = keptMessageIds(deal);
  const ids = promptIds(deal);
  if (chatId == null || ids.length === 0) {
    return deal.botPromptIds?.length
      ? (store.update(deal.id, { botPromptIds: [] }) ?? deal)
      : deal;
  }

  const retained: number[] = [];
  for (const messageId of ids) {
    if (keep.has(messageId)) {
      retained.push(messageId);
      continue;
    }
    await deleteMessageSafe(api, chatId, messageId);
  }

  return store.update(deal.id, { botPromptIds: retained }) ?? deal;
}

/** Aggiunge message_id alla lista prompt tracciati sul deal. */
export function trackPrompt(
  store: DealStore,
  deal: Deal,
  messageId: number,
): Deal {
  const ids = [...promptIds(deal), messageId];
  return store.update(deal.id, { botPromptIds: ids }) ?? deal;
}

/**
 * Rimuove un message_id dai prompt cancellabili (es. ToS appena accettati).
 * Il messaggio resta in chat; va tracciato a parte se va protetto.
 */
export function untrackPrompt(
  store: DealStore,
  deal: Deal,
  messageId: number,
): Deal {
  const ids = promptIds(deal).filter((id) => id !== messageId);
  if (ids.length === promptIds(deal).length) return deal;
  return store.update(deal.id, { botPromptIds: ids }) ?? deal;
}

/**
 * Invia un prompt di stage nel gruppo, opzionalmente cancellando i precedenti.
 * Restituisce il deal aggiornato con il nuovo message_id tracciato.
 * La card setup (`setupMessageId` / ToS accettati) non viene cancellata.
 */
export async function sendTrackedPrompt(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
  opts?: { clearPrevious?: boolean },
): Promise<Deal> {
  let current = deal;
  if (opts?.clearPrevious !== false) {
    current = await clearBotPrompts(api, store, current);
  }
  if (current.groupChatId == null) return current;

  const msg = await api.sendMessage(current.groupChatId, text, extra);
  return trackPrompt(store, current, msg.message_id);
}

/**
 * Unico messaggio vivente di setup (termini Prodotto/Prezzo/Condizioni):
 * edit in place se `setupMessageId` esiste, altrimenti send + salva id.
 */
export async function upsertSetupMessage(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) return deal;

  const msgId = deal.setupMessageId;
  if (msgId != null) {
    try {
      await api.editMessageText(chatId, msgId, text, extra);
      return deal;
    } catch (err) {
      if (isNotModifiedError(err)) return deal;
      console.warn(
        `edit setup msg ${msgId} in ${chatId} failed, re-sending:`,
        err,
      );
    }
  }

  const msg = await api.sendMessage(chatId, text, extra);
  return store.update(deal.id, { setupMessageId: msg.message_id }) ?? deal;
}

/**
 * Cancella risposte effimere precedenti (action reply + /stato) nel gruppo.
 * Non tocca i prompt di stage né i ToS accettati.
 */
export async function clearEphemeralReplies(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) {
    return store.update(deal.id, {
      lastActionReplyId: undefined,
      lastStatusMessageId: undefined,
    }) ?? deal;
  }

  if (deal.lastActionReplyId != null) {
    await deleteMessageSafe(api, chatId, deal.lastActionReplyId);
  }
  if (deal.lastStatusMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.lastStatusMessageId);
  }

  return (
    store.update(deal.id, {
      lastActionReplyId: undefined,
      lastStatusMessageId: undefined,
    }) ?? deal
  );
}

/**
 * Invia (o sostituisce) la risposta a un’azione deposito (indirizzo / verifica / …).
 * Una sola risposta rilevante resta visibile.
 */
export async function replaceActionReply(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) return deal;

  const current = await clearEphemeralReplies(api, store, deal);
  const msg = await api.sendMessage(chatId, text, extra);
  return (
    store.update(current.id, { lastActionReplyId: msg.message_id }) ?? current
  );
}

/** Cancella l'ultimo /stato del bot (se tracciato) prima di postarne uno nuovo. */
export async function replaceStatusMessage(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) return deal;

  const current = await clearEphemeralReplies(api, store, deal);
  const msg = await api.sendMessage(chatId, text, extra);
  return (
    store.update(current.id, { lastStatusMessageId: msg.message_id }) ?? current
  );
}

/**
 * Pin silenzioso del messaggio ToS accettati. Se fallisce (permessi),
 * il messaggio resta comunque visibile in chat.
 */
export async function pinAcceptedTos(
  api: Api,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  try {
    await api.pinChatMessage(chatId, messageId, {
      disable_notification: true,
    });
    return true;
  } catch (err) {
    console.warn(`pin ToS msg ${messageId} in ${chatId} failed:`, err);
    return false;
  }
}
