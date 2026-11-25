import type { Api } from "grammy";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import {
  groupTosMiniAppKeyboard,
  groupTosMiniAppUrlKeyboard,
} from "../keyboards/menus.js";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import {
  termsReadyForConfirm,
  tosAccepted,
} from "./deal-logic.js";
import { deleteMessageSafe, pinAcceptedTos } from "./prompt-cleanup.js";

function errDetail(err: unknown): string {
  if (err && typeof err === "object" && "description" in err) {
    return String((err as { description?: string }).description ?? err);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Dopo bind controparte (termini pronti): messaggio pinnato con Mini App ToS
 * in sola lettura («Leggi i Termini»). Niente Accetta / `?deal=`. Idempotente.
 */
export async function ensureGroupTosMiniAppPin(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  let current = store.get(deal.id) ?? deal;
  const chatId = current.groupChatId;
  if (chatId == null) return current;
  if (tosAccepted(current)) return current;
  if (
    current.status !== "awaiting_tos_confirm" ||
    !termsReadyForConfirm(current)
  ) {
    return current;
  }

  const tosUrl = config.tosWebAppUrl;
  if (!tosUrl) {
    // Senza host pubblico: niente pin Mini App (card Accetta resta callback).
    return current;
  }

  // Già tracciato: solo re-pin soft (niente ripost se già pinnato / errore banale).
  if (current.tosMiniAppMessageId != null) {
    await pinAcceptedTos(api, chatId, current.tosMiniAppMessageId);
    return current;
  }

  let messageId: number | undefined;
  try {
    const msg = await api.sendMessage(chatId, it.groupTosMiniAppPin, {
      parse_mode: "Markdown",
      reply_markup: groupTosMiniAppKeyboard(tosUrl),
    });
    messageId = msg.message_id;
  } catch (webAppErr) {
    console.warn(
      `[group-tos] web_app pin fallito, fallback url: ${errDetail(webAppErr)}`,
    );
    try {
      const msg = await api.sendMessage(chatId, it.groupTosMiniAppPin, {
        parse_mode: "Markdown",
        reply_markup: groupTosMiniAppUrlKeyboard(tosUrl),
      });
      messageId = msg.message_id;
    } catch (urlErr) {
      console.warn(
        `[group-tos] post Mini App fallito: ${errDetail(urlErr)}`,
      );
      return store.get(current.id) ?? current;
    }
  }

  await pinAcceptedTos(api, chatId, messageId);
  return (
    store.update(current.id, { tosMiniAppMessageId: messageId }) ?? current
  );
}

/** Dopo Accetta (card): togli il teaser Mini App (la card setup resta pinnata). */
export async function clearGroupTosMiniAppPin(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  const msgId = deal.tosMiniAppMessageId;
  if (chatId != null && msgId != null) {
    try {
      await api.unpinChatMessage(chatId, msgId);
    } catch {
      // già unpinnato / permessi
    }
    await deleteMessageSafe(api, chatId, msgId);
  }
  if (deal.tosMiniAppMessageId == null) return deal;
  return (
    store.update(deal.id, { tosMiniAppMessageId: undefined }) ?? deal
  );
}
