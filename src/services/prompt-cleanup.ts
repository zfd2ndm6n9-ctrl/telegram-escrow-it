import type { Api, InlineKeyboard } from "grammy";
import type { Message } from "grammy/types";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import {
  extractMigrateToChatId,
  remapDealGroupChatId,
} from "./group-chat-remap.js";
import {
  isBotKickedOrChatGoneError,
  isMessageMissingError,
  markGroupCompromised,
  maybeCompromiseFromApiError,
} from "./group-compromise.js";

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
  if (deal.tosMiniAppMessageId != null) {
    keep.add(deal.tosMiniAppMessageId);
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
 * sendMessage sul groupChatId del deal; se Telegram ha migrato il gruppo,
 * remappa e ritenta una volta (mai perdere la card sul nuovo id).
 */
async function sendMessageToDealChat(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<{ deal: Deal; message: Message } | { deal: Deal; message: null }> {
  let current = deal;
  const chatId = current.groupChatId;
  if (chatId == null) return { deal: current, message: null };

  try {
    const message = await api.sendMessage(chatId, text, extra);
    return { deal: current, message };
  } catch (err) {
    const toId = extractMigrateToChatId(err);
    if (toId == null) {
      if (isBotKickedOrChatGoneError(err)) {
        current = await markGroupCompromised(
          api,
          store,
          current,
          "group_gone",
        );
        return { deal: current, message: null };
      }
      throw err;
    }
    current =
      remapDealGroupChatId(store, chatId, toId) ??
      store.get(current.id) ??
      current;
    try {
      const message = await api.sendMessage(toId, text, extra);
      return { deal: current, message };
    } catch (err2) {
      if (isBotKickedOrChatGoneError(err2)) {
        current = await markGroupCompromised(
          api,
          store,
          current,
          "group_gone",
        );
        return { deal: current, message: null };
      }
      throw err2;
    }
  }
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

  const sent = await sendMessageToDealChat(api, store, current, text, extra);
  if (!sent.message) return sent.deal;
  return trackPrompt(store, sent.deal, sent.message.message_id);
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

  let current = deal;
  let liveChatId = chatId;
  const msgId = deal.setupMessageId;
  if (msgId != null) {
    try {
      await api.editMessageText(liveChatId, msgId, text, extra);
      return current;
    } catch (err) {
      if (isNotModifiedError(err)) return current;
      const toId = extractMigrateToChatId(err);
      if (toId != null) {
        current =
          remapDealGroupChatId(store, liveChatId, toId) ??
          store.get(current.id) ??
          current;
        liveChatId = toId;
        try {
          await api.editMessageText(liveChatId, msgId, text, extra);
          return current;
        } catch (err2) {
          if (isNotModifiedError(err2)) return current;
          if (isBotKickedOrChatGoneError(err2)) {
            return markGroupCompromised(api, store, current, "group_gone");
          }
          if (isMessageMissingError(err2)) {
            current = await markGroupCompromised(
              api,
              store,
              current,
              "critical_msgs_deleted",
            );
            // Freeze: non ripostare la card completa (azioni congelate).
            return current;
          }
          console.warn(
            `edit setup msg ${msgId} in ${liveChatId} failed after migrate, re-sending:`,
            err2,
          );
        }
      } else if (isBotKickedOrChatGoneError(err)) {
        return markGroupCompromised(api, store, current, "group_gone");
      } else if (isMessageMissingError(err)) {
        current = await markGroupCompromised(
          api,
          store,
          current,
          "critical_msgs_deleted",
        );
        return current;
      } else {
        console.warn(
          `edit setup msg ${msgId} in ${liveChatId} failed, re-sending:`,
          err,
        );
        await maybeCompromiseFromApiError(api, store, current, err);
        current = store.get(current.id) ?? current;
      }
    }
  }

  if (current.groupCompromisedAt) {
    return current;
  }

  const sent = await sendMessageToDealChat(
    api,
    store,
    current.groupChatId === liveChatId
      ? current
      : (store.get(current.id) ?? current),
    text,
    extra,
  );
  if (!sent.message) return sent.deal;
  return (
    store.update(sent.deal.id, { setupMessageId: sent.message.message_id }) ??
    sent.deal
  );
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
  if (deal.groupChatId == null) return deal;

  const current = await clearEphemeralReplies(api, store, deal);
  const sent = await sendMessageToDealChat(api, store, current, text, extra);
  if (!sent.message) return sent.deal;
  return (
    store.update(sent.deal.id, {
      lastActionReplyId: sent.message.message_id,
    }) ?? sent.deal
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
  if (deal.groupChatId == null) return deal;

  const current = await clearEphemeralReplies(api, store, deal);
  const sent = await sendMessageToDealChat(api, store, current, text, extra);
  if (!sent.message) return sent.deal;
  return (
    store.update(sent.deal.id, {
      lastStatusMessageId: sent.message.message_id,
    }) ?? sent.deal
  );
}

/** Cancella l'ultimo errore di ruolo tracciato sul deal (se presente). */
export async function clearRoleError(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId != null && deal.lastRoleErrorMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.lastRoleErrorMessageId);
  }
  if (deal.lastRoleErrorMessageId == null) return deal;
  return (
    store.update(deal.id, { lastRoleErrorMessageId: undefined }) ?? deal
  );
}

/**
 * Invia un errore di ruolo e traccia l'id (sostituisce il precedente).
 * Es. «Solo @seller può segnare la consegna».
 */
export async function replaceRoleError(
  api: Api,
  store: DealStore,
  deal: Deal,
  text: string,
  extra?: PromptExtra,
): Promise<Deal> {
  let current = await clearRoleError(api, store, deal);
  if (current.groupChatId == null) return current;

  const sent = await sendMessageToDealChat(api, store, current, text, extra);
  if (!sent.message) return sent.deal;
  return (
    store.update(sent.deal.id, {
      lastRoleErrorMessageId: sent.message.message_id,
    }) ?? sent.deal
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
