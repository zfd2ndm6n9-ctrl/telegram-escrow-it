import type { Api } from "grammy";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

/** Tempo max tra istruzioni DM «aggiungi bot» e bind gruppo. */
export const GROUP_BIND_TTL_MS = 10 * 60 * 1000;

export function groupBindExpiresAtIso(fromMs = Date.now()): string {
  return new Date(fromMs + GROUP_BIND_TTL_MS).toISOString();
}

/**
 * Annulla deal `awaiting_group` senza `groupChatId` oltre `awaitingGroupExpiresAt`.
 * Notifica il creator in DM e cancella le istruzioni gruppo se tracciate.
 */
export function startGroupBindExpiryWatcher(
  store: DealStore,
  api: Api,
  intervalMs = 30_000,
): { stop: () => void } {
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const now = Date.now();
      for (const deal of store.listByStatus("awaiting_group")) {
        if (deal.groupChatId != null) continue;
        if (!deal.awaitingGroupExpiresAt) continue;
        const expires = Date.parse(deal.awaitingGroupExpiresAt);
        if (!Number.isFinite(expires) || expires > now) continue;

        const instructionsId = deal.dmGroupInstructionsMessageId;
        store.update(deal.id, {
          status: "cancelled",
          awaitingGroupExpiresAt: undefined,
          dmGroupInstructionsMessageId: undefined,
        });

        if (instructionsId != null) {
          await deleteMessageSafe(api, deal.creatorId, instructionsId);
        }

        try {
          await api.sendMessage(deal.creatorId, it.groupBindExpired(deal), {
            parse_mode: "Markdown",
            reply_markup: mainMenuKeyboard(),
          });
        } catch (err) {
          console.warn(
            `group-bind-expiry notify #${deal.id} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
        console.log(
          `Deal #${deal.id} auto-cancelled: gruppo non collegato entro 10 min`,
        );
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
