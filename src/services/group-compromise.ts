import type { Api } from "grammy";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import type { Deal, DealStatus, GroupCompromiseReason } from "../types.js";

const TERMINAL: DealStatus[] = ["released", "refunded", "cancelled"];

export function isTerminalDeal(deal: Deal): boolean {
  return TERMINAL.includes(deal.status);
}

/** Gruppo perso / bot kick / wipe → niente azioni parti in gruppo. */
export function isGroupActionsFrozen(deal: Deal): boolean {
  return Boolean(deal.groupCompromisedAt);
}

export function telegramErrorText(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  if ("description" in err && (err as { description?: unknown }).description) {
    return String((err as { description: unknown }).description);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Bot kick / gruppo cancellato / chat non trovata. */
export function isBotKickedOrChatGoneError(err: unknown): boolean {
  const msg = telegramErrorText(err);
  return /bot was kicked|chat not found|bot is not a member|group chat was (deleted|upgraded)|have no rights to send|not enough rights/i.test(
    msg,
  );
}

/** Card setup / ToS cancellata (edit fallisce). */
export function isMessageMissingError(err: unknown): boolean {
  const msg = telegramErrorText(err);
  return /message to edit not found|MESSAGE_ID_INVALID|message can't be edited|message to be replied not found/i.test(
    msg,
  );
}

/**
 * Marca deal compromesso (idempotente) e DM admin con id + stato corto.
 * Skip su deal già chiusi (release/refund/cancel) — leave post-cleanup non è alert.
 */
export async function markGroupCompromised(
  api: Api,
  store: DealStore,
  deal: Deal,
  reason: GroupCompromiseReason,
  opts?: { detail?: string },
): Promise<Deal> {
  if (isTerminalDeal(deal)) {
    return store.get(deal.id) ?? deal;
  }

  const already = Boolean(deal.groupCompromisedAt);
  const updated =
    store.update(deal.id, {
      groupCompromisedAt: deal.groupCompromisedAt ?? new Date().toISOString(),
      groupCompromisedReason: deal.groupCompromisedReason ?? reason,
    }) ?? deal;

  if (already) {
    return store.get(updated.id) ?? updated;
  }

  console.warn(
    `Group compromised #${updated.id} reason=${reason}` +
      (opts?.detail ? ` (${opts.detail})` : ""),
  );

  await notifyAdminsGroupCompromised(api, updated, reason);
  return store.get(updated.id) ?? updated;
}

/** Se l'errore API indica gruppo perso / wipe critico → marca + DM. */
export async function maybeCompromiseFromApiError(
  api: Api,
  store: DealStore,
  deal: Deal,
  err: unknown,
): Promise<Deal> {
  if (isTerminalDeal(deal) || isGroupActionsFrozen(deal)) {
    return store.get(deal.id) ?? deal;
  }
  if (isBotKickedOrChatGoneError(err)) {
    return markGroupCompromised(api, store, deal, "group_gone", {
      detail: telegramErrorText(err).slice(0, 120),
    });
  }
  if (isMessageMissingError(err) && deal.setupMessageId != null) {
    return markGroupCompromised(api, store, deal, "critical_msgs_deleted", {
      detail: telegramErrorText(err).slice(0, 120),
    });
  }
  return store.get(deal.id) ?? deal;
}

async function notifyAdminsGroupCompromised(
  api: Api,
  deal: Deal,
  reason: GroupCompromiseReason,
): Promise<void> {
  const ids = config.adminTelegramIds;
  if (!ids.length) {
    console.warn(
      `Group compromise #${deal.id}: nessun ADMIN_TELEGRAM_ID/S — skip DM`,
    );
    return;
  }
  const body = it.groupCompromisedAdminDm(deal, reason);
  for (const adminId of ids) {
    try {
      await api.sendMessage(Number(adminId), body, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error(
        `DM admin ${adminId} group-compromise #${deal.id} fallita:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
