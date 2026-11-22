import type { Api } from "grammy";
import type { DealStore } from "../store/deals.js";
import type { Deal, DealStatus } from "../types.js";

const TERMINAL: DealStatus[] = ["released", "refunded", "cancelled"];

/** Stati in cui la card / prompt vivono nel gruppo (wallet turn incluso). */
const HOT_GROUP_STATUSES: DealStatus[] = [
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
];

function isActiveDeal(deal: Deal): boolean {
  return !TERMINAL.includes(deal.status);
}

function isHotGroupDeal(deal: Deal): boolean {
  return HOT_GROUP_STATUSES.includes(deal.status);
}

function errorDescription(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  if ("description" in err && (err as { description?: unknown }).description) {
    return String((err as { description: unknown }).description);
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Bot API: dopo upgrade group→supergroup, send/edit sull'id vecchio
 * fallisce con `parameters.migrate_to_chat_id`.
 */
export function extractMigrateToChatId(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const direct = (err as { parameters?: { migrate_to_chat_id?: unknown } })
    .parameters?.migrate_to_chat_id;
  if (typeof direct === "number") return direct;
  const nested = (
    err as { error?: { parameters?: { migrate_to_chat_id?: unknown } } }
  ).error?.parameters?.migrate_to_chat_id;
  if (typeof nested === "number") return nested;
  return undefined;
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
 * Dopo title/photo (o errore migrate): allinea `groupChatId` all'id live.
 * Passa `knownNewChatId` solo se già noto (es. parameters.migrate_to_chat_id).
 */
export async function syncDealLiveChatId(
  api: Api,
  store: DealStore,
  deal: Deal,
  knownNewChatId?: number,
): Promise<Deal> {
  if (deal.groupChatId == null) {
    if (knownNewChatId == null) return deal;
    return store.update(deal.id, { groupChatId: knownNewChatId }) ?? deal;
  }

  const fromId = deal.groupChatId;
  const liveId =
    knownNewChatId ?? (await resolveLiveChatId(api, fromId));
  if (liveId === fromId) return store.get(deal.id) ?? deal;
  return remapDealGroupChatId(store, fromId, liveId) ?? deal;
}

function titleMatchesDeal(title: string, deal: Deal): boolean {
  return title.includes(`#${deal.id}`);
}

/**
 * Heal: `findByGroupChatId(chatId)` miss dopo migrazione (handler perso / race).
 *
 * Ordine:
 * 1. `getChat(oldId)` → nuovo id == chatId
 * 2. Titolo chat contiene `#dealId` (card/title live)
 * 3. Orfani (old id morto) o soft-stale (getChat resta sull'id vecchio)
 * 4. Un solo deal hot della parte in questo chat vuoto → remap
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
  const softStale: Deal[] = [];

  for (const deal of pool) {
    const oldId = deal.groupChatId!;
    try {
      const live = await api.getChat(oldId);
      if (live.id === chatId) {
        return remapDealGroupChatId(store, oldId, chatId);
      }
      // getChat ancora sull'id pre-migrazione mentre gli update usano già chatId.
      if (live.id === oldId) {
        softStale.push(deal);
      }
      // Altrimenti live.id è un terzo chat → deal ancora altrove, non toccare.
    } catch {
      deadOrphans.push(deal);
    }
  }

  // Fingerprint titolo: «Escrow #<id> · …» dopo refreshGroupTitle.
  try {
    const chat = await api.getChat(chatId);
    const title =
      chat && typeof chat === "object" && "title" in chat
        ? String((chat as { title?: string }).title ?? "")
        : "";
    if (title) {
      const scoped = (
        userId != null ? pool : store.listAll().filter(isActiveDeal)
      ).filter(
        (d) =>
          d.groupChatId != null &&
          d.groupChatId !== chatId &&
          titleMatchesDeal(title, d),
      );
      // Dedup by id
      const unique = [...new Map(scoped.map((d) => [d.id, d])).values()];
      if (unique.length === 1) {
        const only = unique[0]!;
        console.warn(
          `healMigratedGroupDeal: title match #${only.id} ${only.groupChatId} → ${chatId}`,
        );
        return remapDealGroupChatId(store, only.groupChatId!, chatId);
      }
    }
  } catch {
    // chat non leggibile
  }

  const orphanCandidates = [
    ...new Map(
      [...deadOrphans, ...softStale].map((d) => [d.id, d]),
    ).values(),
  ];

  if (
    userId != null &&
    orphanCandidates.length === 1 &&
    !store.findByGroupChatId(chatId)
  ) {
    const only = orphanCandidates[0]!;
    console.warn(
      `healMigratedGroupDeal: single orphan #${only.id} ${only.groupChatId} → ${chatId} (user ${userId})`,
    );
    return remapDealGroupChatId(store, only.groupChatId!, chatId);
  }

  // Soft-launch: una sola card hot della parte, chat senza deal → è questa.
  if (userId != null && !store.findByGroupChatId(chatId)) {
    const hotOrphans = orphanCandidates.filter(isHotGroupDeal);
    if (hotOrphans.length === 1) {
      const only = hotOrphans[0]!;
      console.warn(
        `healMigratedGroupDeal: single hot orphan #${only.id} ${only.groupChatId} → ${chatId} (user ${userId})`,
      );
      return remapDealGroupChatId(store, only.groupChatId!, chatId);
    }
    const hotPool = pool.filter(isHotGroupDeal);
    if (hotPool.length === 1 && orphanCandidates.some((d) => d.id === hotPool[0]!.id)) {
      const only = hotPool[0]!;
      console.warn(
        `healMigratedGroupDeal: single hot pool #${only.id} ${only.groupChatId} → ${chatId} (user ${userId})`,
      );
      return remapDealGroupChatId(store, only.groupChatId!, chatId);
    }
  }

  return undefined;
}

/** Lookup canonico gruppo → deal (direct + heal migrazione). */
export async function findDealForGroupChat(
  api: Api,
  store: DealStore,
  chatId: number,
  userId?: number,
): Promise<Deal | undefined> {
  return (
    store.findByGroupChatId(chatId) ??
    (await healMigratedGroupDeal(api, store, chatId, userId))
  );
}
