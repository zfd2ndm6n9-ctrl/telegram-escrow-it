import type { Api } from "grammy";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import type { Deal } from "../types.js";

/** ~30 min dopo closed (released/refunded) → delete/leave gruppo. */
export const GROUP_DELETE_AFTER_MS = 30 * 60 * 1000;

export function groupDeleteAtIso(fromMs = Date.now()): string {
  return new Date(fromMs + GROUP_DELETE_AFTER_MS).toISOString();
}

function errDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; description?: unknown };
    if (typeof e.description === "string" && e.description.trim()) {
      return e.description;
    }
    if (typeof e.message === "string" && e.message.trim()) {
      return e.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Prova a eliminare il gruppo (Bot API `deleteChat` se esposta / forward-compat).
 * Serve creator o admin con diritti sufficienti; spesso fallisce sui gruppi manuali.
 * Soft-fail: mai throw.
 */
async function tryDeleteChat(api: Api, chatId: number): Promise<boolean> {
  const raw = api.raw as {
    deleteChat?: (payload: { chat_id: number }) => Promise<true>;
  };
  if (typeof raw.deleteChat !== "function") {
    return false;
  }
  try {
    await raw.deleteChat({ chat_id: chatId });
    console.log(`[group-cleanup] deleteChat ok chat=${chatId}`);
    return true;
  } catch (err) {
    console.warn(
      `[group-cleanup] deleteChat failed chat=${chatId}: ${errDetail(err)}`,
    );
    return false;
  }
}

/**
 * Il bot può tentare delete se creator, oppure admin con can_delete_messages
 * (non serve essere “owner” in senso umano). Soft check — errori → false.
 */
async function botMayTryDeleteChat(
  api: Api,
  chatId: number,
): Promise<boolean> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);
    if (member.status === "creator") return true;
    if (member.status === "administrator") {
      return Boolean(
        "can_delete_messages" in member && member.can_delete_messages,
      );
    }
    return false;
  } catch (err) {
    console.warn(
      `[group-cleanup] getChatMember self failed chat=${chatId}: ${errDetail(err)}`,
    );
    return false;
  }
}

export type GroupCleanupResult = "deleted" | "left" | "failed" | "skipped";

/**
 * Best-effort: deleteChat se permesso, altrimenti notice + leaveChat.
 * Mai throw — soft-fail.
 */
export async function cleanupClosedGroupChat(
  api: Api,
  chatId: number,
): Promise<GroupCleanupResult> {
  try {
    const mayDelete = await botMayTryDeleteChat(api, chatId);
    if (mayDelete) {
      const deleted = await tryDeleteChat(api, chatId);
      if (deleted) return "deleted";
    }

    try {
      await api.sendMessage(chatId, it.groupClosingNotice, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.warn(
        `[group-cleanup] notice failed chat=${chatId}: ${errDetail(err)}`,
      );
    }

    try {
      await api.leaveChat(chatId);
      console.log(`[group-cleanup] leaveChat ok chat=${chatId}`);
      return "left";
    } catch (err) {
      console.warn(
        `[group-cleanup] leaveChat failed chat=${chatId}: ${errDetail(err)}`,
      );
      return "failed";
    }
  } catch (err) {
    console.warn(
      `[group-cleanup] unexpected chat=${chatId}: ${errDetail(err)}`,
    );
    return "failed";
  }
}

function isClosedDeal(deal: Deal): boolean {
  return deal.status === "released" || deal.status === "refunded";
}

/**
 * Watcher: deal chiusi con `groupDeleteAt` scaduto → cleanup gruppo.
 */
export function startGroupCloseCleanupWatcher(
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
      const closed = [
        ...store.listByStatus("released"),
        ...store.listByStatus("refunded"),
      ];
      for (const deal of closed) {
        if (!deal.groupDeleteAt || deal.groupCleanupDoneAt) continue;
        if (deal.groupChatId == null) {
          store.update(deal.id, {
            groupDeleteAt: undefined,
            groupCleanupDoneAt: new Date().toISOString(),
          });
          continue;
        }
        const when = Date.parse(deal.groupDeleteAt);
        if (!Number.isFinite(when) || when > now) continue;

        const chatId = deal.groupChatId;
        const result = await cleanupClosedGroupChat(api, chatId);
        store.update(deal.id, {
          groupDeleteAt: undefined,
          groupCleanupDoneAt: new Date().toISOString(),
        });
        console.log(
          `[group-cleanup] deal=#${deal.id} chat=${chatId} result=${result}`,
        );
      }
    } catch (err) {
      console.warn(
        `[group-cleanup] tick error: ${errDetail(err)}`,
      );
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

/** Schedule cleanup ~30m dopo closed; no-op se già schedulato/fatto. */
export function scheduleGroupCloseCleanup(
  store: DealStore,
  deal: Deal,
): Deal {
  if (!isClosedDeal(deal)) return deal;
  if (deal.groupCleanupDoneAt) return deal;
  if (deal.groupChatId == null) return deal;
  if (deal.groupDeleteAt) return deal;
  return (
    store.update(deal.id, {
      groupDeleteAt: groupDeleteAtIso(),
    }) ?? deal
  );
}
