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

/**
 * Elimina i prompt obsoleti del bot (non i messaggi utente).
 * Tollerante: messaggio già cancellato / permessi mancanti → skip.
 */
export async function clearBotPrompts(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  const ids = promptIds(deal);
  if (chatId == null || ids.length === 0) {
    return deal.botPromptIds?.length
      ? (store.update(deal.id, { botPromptIds: [] }) ?? deal)
      : deal;
  }

  for (const messageId of ids) {
    try {
      await api.deleteMessage(chatId, messageId);
    } catch {
      // già eliminato o senza permesso
    }
  }

  return store.update(deal.id, { botPromptIds: [] }) ?? deal;
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
 * Invia un prompt di stage nel gruppo, opzionalmente cancellando i precedenti.
 * Restituisce il deal aggiornato con il nuovo message_id tracciato.
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

/** Cancella l'ultimo /stato del bot (se tracciato) prima di postarne uno nuovo. */
export async function replaceStatusMessage(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<Deal> {
  if (deal.groupChatId == null) return deal;

  if (deal.lastStatusMessageId != null) {
    try {
      await api.deleteMessage(deal.groupChatId, deal.lastStatusMessageId);
    } catch {
      // ok
    }
  }

  const msg = await api.sendMessage(deal.groupChatId, text, extra);
  return (
    store.update(deal.id, { lastStatusMessageId: msg.message_id }) ?? deal
  );
}
