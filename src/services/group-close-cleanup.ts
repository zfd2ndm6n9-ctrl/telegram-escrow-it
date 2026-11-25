import type { Api } from "grammy";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import type { Deal } from "../types.js";
import {
  deleteHelperOwnedGroup,
  isMtprotoHelperConfigured,
} from "./mtproto-helper.js";

/** ~1 min dopo payout/refund riuscito → delete gruppo (helper MTProto). */
export const GROUP_DELETE_AFTER_MS = 60 * 1000;

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
 * Best-effort delete dopo closed:
 * 1. Helper-owned → MTProto `channels.DeleteChannel` (owner)
 * 2. Altrimenti Bot API deleteChat se permesso
 * 3. Altrimenti leaveChat (gruppi manuali)
 * Mai throw — soft-fail + log chiaro.
 */
export async function cleanupClosedGroupChat(
  api: Api,
  deal: Deal,
): Promise<GroupCleanupResult> {
  const chatId = deal.groupChatId;
  if (chatId == null) return "skipped";

  try {
    // Solo gruppi creati dall'helper (owner): DeleteChannel. Manuali → Bot API.
    const preferHelper =
      deal.groupCreatedVia === "helper" ||
      (deal.groupAccessHash != null && deal.groupAccessHash.length > 0);

    if (preferHelper && isMtprotoHelperConfigured()) {
      const deleted = await deleteHelperOwnedGroup(
        chatId,
        deal.groupAccessHash,
      );
      if (deleted) return "deleted";
      // Helper path fallito: continua con fallback Bot API (soft).
      console.warn(
        `[group-cleanup] MTProto delete miss deal=#${deal.id} chat=${chatId} — fallback Bot API`,
      );
    }

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
        `[group-cleanup] leave-notice failed chat=${chatId}: ${errDetail(err)}`,
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
      `[group-cleanup] unexpected deal=#${deal.id} chat=${chatId}: ${errDetail(err)}`,
    );
    return "failed";
  }
}

function isClosedDeal(deal: Deal): boolean {
  return deal.status === "released" || deal.status === "refunded";
}

async function sendClosingSoonNotice(
  api: Api,
  chatId: number,
  dealId: string,
): Promise<void> {
  try {
    await api.sendMessage(chatId, it.groupClosingSoonNotice, {
      parse_mode: "Markdown",
    });
    console.log(
      `[group-cleanup] closing-soon notice ok deal=#${dealId} chat=${chatId}`,
    );
  } catch (err) {
    console.warn(
      `[group-cleanup] closing-soon notice failed deal=#${dealId} chat=${chatId}: ${errDetail(err)}`,
    );
  }
}

/**
 * Watcher: deal chiusi con `groupDeleteAt` scaduto → cleanup gruppo.
 */
export function startGroupCloseCleanupWatcher(
  store: DealStore,
  api: Api,
  intervalMs = 15_000,
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
        const result = await cleanupClosedGroupChat(api, deal);
        store.update(deal.id, {
          groupDeleteAt: undefined,
          groupCleanupDoneAt: new Date().toISOString(),
        });
        console.log(
          `[group-cleanup] deal=#${deal.id} chat=${chatId} result=${result}`,
        );
      }
    } catch (err) {
      console.warn(`[group-cleanup] tick error: ${errDetail(err)}`);
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

/**
 * Schedule cleanup ~1 min dopo closed; invia avviso corto una sola volta.
 * No-op se già schedulato/fatto. Soft-fail su notice.
 */
export function scheduleGroupCloseCleanup(
  store: DealStore,
  deal: Deal,
  api?: Api,
): Deal {
  if (!isClosedDeal(deal)) return deal;
  if (deal.groupCleanupDoneAt) return deal;
  if (deal.groupChatId == null) return deal;
  if (deal.groupDeleteAt) return deal;

  const updated =
    store.update(deal.id, {
      groupDeleteAt: groupDeleteAtIso(),
    }) ?? deal;

  if (api && updated.groupChatId != null) {
    void sendClosingSoonNotice(api, updated.groupChatId, updated.id);
  }

  console.log(
    `[group-cleanup] scheduled deal=#${updated.id} chat=${updated.groupChatId} at=${updated.groupDeleteAt} (~1 min)`,
  );
  return updated;
}
