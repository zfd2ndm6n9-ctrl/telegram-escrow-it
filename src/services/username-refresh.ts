import type { Api } from "grammy";
import type { DealStore } from "../store/deals.js";
import type { MemberStore } from "../store/members.js";
import type { Deal } from "../types.js";
import { refreshGroupSetupCard } from "./group-setup.js";

const ACTIVE_STATUSES = new Set<Deal["status"]>([
  "awaiting_group",
  "awaiting_bot_admin",
  "awaiting_counterpart",
  "awaiting_tos",
  "awaiting_tos_confirm",
  "awaiting_amount",
  "awaiting_amount_confirm",
  "awaiting_seller_wallet",
  "awaiting_buyer_wallet",
  "awaiting_deposit",
  "funded",
  "release_pending",
  "refund_pending",
  "disputed",
]);

/** Max getChat per tick (anti-hammer Telegram). */
const BATCH_PER_TICK = 25;

function collectUserIds(store: DealStore, members: MemberStore): number[] {
  const ids = new Set<number>();
  for (const m of members.listAll()) {
    ids.add(m.userId);
  }
  for (const deal of store.listAll()) {
    if (!ACTIVE_STATUSES.has(deal.status)) continue;
    if (deal.creatorId) ids.add(deal.creatorId);
    if (deal.buyerId != null) ids.add(deal.buyerId);
    if (deal.sellerId != null) ids.add(deal.sellerId);
  }
  return [...ids].sort((a, b) => a - b);
}

function patchDealUsernames(
  deal: Deal,
  userId: number,
  username: string | undefined,
): Partial<Deal> | null {
  const patch: Partial<Deal> = {};
  if (deal.creatorId === userId && deal.creatorUsername !== username) {
    patch.creatorUsername = username;
  }
  if (deal.buyerId === userId && deal.buyerUsername !== username) {
    patch.buyerUsername = username;
  }
  if (deal.sellerId === userId && deal.sellerUsername !== username) {
    patch.sellerUsername = username;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Refresh leggero degli @ Telegram per iscritti + parti deal attivi.
 * Usa getChat (utenti che hanno aperto il bot); non spam RPC.
 */
export function startUsernameRefresh(
  api: Api,
  store: DealStore,
  members: MemberStore,
  intervalMs = 60_000,
): { stop: () => void } {
  let cursor = 0;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const ids = collectUserIds(store, members);
      if (ids.length === 0) return;

      const batch: number[] = [];
      for (let i = 0; i < BATCH_PER_TICK && i < ids.length; i++) {
        batch.push(ids[(cursor + i) % ids.length]!);
      }
      cursor = (cursor + batch.length) % Math.max(ids.length, 1);

      const changedDeals = new Set<string>();

      for (const userId of batch) {
        let username: string | undefined;
        try {
          const chat = await api.getChat(userId);
          username =
            "username" in chat && typeof chat.username === "string"
              ? chat.username
              : undefined;
        } catch {
          // utente non ha /start o privacy: skip
          continue;
        }

        const memberChanged = members.refreshUsername(userId, username);
        if (!memberChanged && username == null) continue;

        for (const deal of store.listForUser(userId)) {
          if (!ACTIVE_STATUSES.has(deal.status)) continue;
          const patch = patchDealUsernames(deal, userId, username);
          if (!patch) continue;
          store.update(deal.id, patch);
          if (deal.groupChatId != null && deal.setupMessageId != null) {
            changedDeals.add(deal.id);
          }
        }
      }

      for (const dealId of changedDeals) {
        const deal = store.get(dealId);
        if (!deal || deal.groupChatId == null) continue;
        try {
          await refreshGroupSetupCard(api, store, deal);
        } catch (err) {
          console.warn(
            `[username-refresh] card #${dealId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } catch (err) {
      console.warn(
        "[username-refresh] tick failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => {
    void tick();
  }, intervalMs);
  // Non bloccare lo shutdown Node
  handle.unref?.();

  console.log(
    `Username refresh: ogni ${Math.round(intervalMs / 1000)}s (batch ≤${BATCH_PER_TICK})`,
  );

  return {
    stop: () => clearInterval(handle),
  };
}
