import type { Api } from "grammy";
import type { DealLogStore } from "../store/deal-logs.js";
import type { DealStore } from "../store/deals.js";
import type { Deal, DealStatus, GroupCompromiseReason } from "../types.js";

/** Opzionale: log silenzioso su wipe card (niente reply in gruppo). */
let dealLogsRef: DealLogStore | undefined;

export function setGroupCompromiseDealLogs(logs: DealLogStore): void {
  dealLogsRef = logs;
}

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
 * Marca deal compromesso (idempotente). Nessun DM admin.
 * Skip su deal già chiusi (release/refund/cancel) — leave post-cleanup non è alert.
 * `api` tenuto nella firma per call-site stabili (ex notify path).
 */
export async function markGroupCompromised(
  _api: Api,
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

  // Log silenzioso per /deal|/log — mai reply di igiene in gruppo su delete.
  try {
    dealLogsRef?.appendEvent(
      updated.id,
      `group_compromised:${reason}` +
        (opts?.detail ? ` (${opts.detail.slice(0, 80)})` : ""),
    );
  } catch {
    // store log best-effort
  }

  return store.get(updated.id) ?? updated;
}

/** Se l'errore API indica gruppo perso / wipe critico → marca (niente DM). */
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
