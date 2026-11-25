import type { Api } from "grammy";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import { clearDmTermsUi } from "./dm-terms.js";
import { stripPersistentReplyKeyboardChat } from "./dm-hygiene.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

/** Tempo max tra istruzioni DM «aggiungi bot» e bind gruppo. */
export const GROUP_BIND_TTL_MS = 10 * 60 * 1000;

export function groupBindExpiresAtIso(fromMs = Date.now()): string {
  return new Date(fromMs + GROUP_BIND_TTL_MS).toISOString();
}

/**
 * Annulla deal early senza progresso oltre `awaitingGroupExpiresAt`:
 * - `awaiting_group` senza `groupChatId` (TTL da create / istruzioni DM)
 * - `awaiting_bot_admin` con gruppo bound ma mai /avvia completato
 * Notifica il creator in DM e cancella le istruzioni gruppo se tracciate.
 */
export function startGroupBindExpiryWatcher(
  store: DealStore,
  api: Api,
  intervalMs = 30_000,
): { stop: () => void } {
  let stopped = false;
  let running = false;

  const expireDeal = async (
    deal: ReturnType<DealStore["listByStatus"]>[number],
    reason: string,
  ) => {
    const instructionsId = deal.dmGroupInstructionsMessageId;
    // Cancella anche prompt/riepilogo termini DM (non solo istruzioni gruppo).
    await clearDmTermsUi(api, store, deal, deal.creatorId);
    store.update(deal.id, {
      status: "cancelled",
      awaitingGroupExpiresAt: undefined,
      dmGroupInstructionsMessageId: undefined,
    });

    if (instructionsId != null) {
      await deleteMessageSafe(api, deal.creatorId, instructionsId);
    }

    try {
      await stripPersistentReplyKeyboardChat(api, deal.creatorId);
      const notice = await api.sendMessage(
        deal.creatorId,
        it.groupBindExpired(deal),
        {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(),
        },
      );
      store.update(deal.id, {
        dmGroupBindExpiredMessageId: notice.message_id,
      });
    } catch (err) {
      console.warn(
        `group-bind-expiry notify #${deal.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
    console.log(`Deal #${deal.id} auto-cancelled: ${reason}`);
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const now = Date.now();
      const candidates = [
        ...store.listByStatus("awaiting_group"),
        ...store.listByStatus("awaiting_bot_admin"),
      ];
      for (const deal of candidates) {
        if (!deal.awaitingGroupExpiresAt) continue;
        const expires = Date.parse(deal.awaitingGroupExpiresAt);
        if (!Number.isFinite(expires) || expires > now) continue;

        if (deal.status === "awaiting_group" && deal.groupChatId != null) {
          // Bound mid-flight via my_chat_member senza clear TTL: tratta come bot_admin.
        }
        if (deal.status === "awaiting_group" && deal.groupChatId == null) {
          await expireDeal(
            deal,
            "gruppo non collegato entro 10 min",
          );
          continue;
        }
        if (
          deal.status === "awaiting_bot_admin" ||
          (deal.status === "awaiting_group" && deal.groupChatId != null)
        ) {
          await expireDeal(
            deal,
            "bot in gruppo ma /avvia non completato entro 10 min",
          );
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
