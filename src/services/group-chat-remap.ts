import type { Api } from "grammy";
import type { DealStore } from "../store/deals.js";
import type { Deal, DealStatus } from "../types.js";

const TERMINAL: DealStatus[] = ["released", "refunded", "cancelled"];

function isActiveDeal(deal: Deal): boolean {
  return !TERMINAL.includes(deal.status);
}

/**
 * Dopo setChatPhoto (e legacy setChatTitle) Telegram può migrare
 * group → supergroup cambiando l'id. `getChat(oldId)` restituisce spesso
 * il chat con il nuovo id.
 */
export async function resolveLiveChatId(
  api: Api,
  chatId: number,
): Promise<number> {
  try {
    const chat = await api.getChat(chatId);
    return chat.id;
  } catch {
    return chatId;
  }
}

/** Aggiorna `groupChatId` se il deal è ancora legato al vecchio id. */
export function remapDealGroupChatId(
  store: DealStore,
  fromChatId: number,
  toChatId: number,
): Deal | undefined {
  if (fromChatId === toChatId) {
    return store.findByGroupChatId(toChatId);
  }
  const deal = store.findByGroupChatId(fromChatId);
  if (!deal) return store.findByGroupChatId(toChatId);
  const occupied = store.findByGroupChatId(toChatId);
  if (occupied && occupied.id !== deal.id) {
    console.warn(
      `remap groupChatId blocked: #${deal.id} ${fromChatId}→${toChatId} already has #${occupied.id}`,
    );
    return deal;
  }
  const updated =
    store.update(deal.id, { groupChatId: toChatId }) ?? deal;
  console.log(
    `Deal #${updated.id} remapped groupChatId ${fromChatId} → ${toChatId}`,
  );
  return updated;
}

/**
 * Heal: `findByGroupChatId(chatId)` miss dopo migrazione (handler perso / race).
 * - Preferisce deal della parte il cui `getChat(oldId)` risolve a `chatId`.
 * - Fallback soft-launch: un solo deal attivo orfano (old id morto) → remap.
 */
export async function healMigratedGroupDeal(
  api: Api,
  store: DealStore,
  chatId: number,
  userId?: number,
): Promise<Deal | undefined> {
  const existing = store.findByGroupChatId(chatId);
  if (existing) return existing;

  const pool = (
    userId != null ? store.listForUser(userId) : store.listAll()
  ).filter(
    (d) =>
      isActiveDeal(d) &&
      d.groupChatId != null &&
      d.groupChatId !== chatId,
  );

  const deadOrphans: Deal[] = [];

  for (const deal of pool) {
    const oldId = deal.groupChatId!;
    try {
      const live = await api.getChat(oldId);
      if (live.id === chatId) {
        return remapDealGroupChatId(store, oldId, chatId);
      }
    } catch {
      deadOrphans.push(deal);
    }
  }

  if (
    userId != null &&
    deadOrphans.length === 1 &&
    !store.findByGroupChatId(chatId)
  ) {
    const only = deadOrphans[0]!;
    console.warn(
      `healMigratedGroupDeal: single orphan #${only.id} ${only.groupChatId} → ${chatId} (user ${userId})`,
    );
    return remapDealGroupChatId(store, only.groupChatId!, chatId);
  }

  return undefined;
}
