/**
 * Smoke: group→supergroup heal must find the deal for /wallet after stale id.
 * npm exec tsx scripts/check-group-chat-remap.ts
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DealStore } from "../src/store/deals.js";
import type { Deal } from "../src/types.js";
import {
  extractMigrateToChatId,
  findDealForGroupChat,
  healMigratedGroupDeal,
  remapDealGroupChatId,
} from "../src/services/group-chat-remap.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const dir = mkdtempSync(join(tmpdir(), "escrow-remap-"));
const store = new DealStore(dir);

function seedDeal(partial: Partial<Deal> & Pick<Deal, "id" | "groupChatId">): Deal {
  const ts = new Date().toISOString();
  const deal: Deal = {
    id: partial.id,
    creatorId: partial.creatorId ?? 1001,
    creatorUsername: "buyer",
    creatorRole: "buyer",
    buyerId: partial.buyerId ?? 1001,
    sellerId: partial.sellerId ?? 2002,
    amount: "1",
    asset: "SOL",
    status: partial.status ?? "awaiting_seller_wallet",
    escrowAddress: "EscrowAddr1111111111111111111111111111111",
    releaseVotes: [],
    refundVotes: [],
    amountVotes: [],
    botPromptIds: partial.botPromptIds ?? [],
    groupChatId: partial.groupChatId,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
  return store.upsert(deal);
}

type FakeChat = { id: number; type: string; title?: string };

function fakeApi(map: Map<number, FakeChat | "dead">): {
  getChat: (id: number) => Promise<FakeChat>;
} {
  return {
    async getChat(id: number) {
      const v = map.get(id);
      if (v === "dead" || v == null) {
        throw new Error(`chat not found: ${id}`);
      }
      return v;
    },
  };
}

const OLD = -111000;
const NEW = -100111000;
const SELLER = 2002;

// 1) extractMigrateToChatId
assert(
  extractMigrateToChatId({
    parameters: { migrate_to_chat_id: NEW },
  }) === NEW,
  "extract migrate id from parameters",
);
assert(
  extractMigrateToChatId({
    error: { parameters: { migrate_to_chat_id: NEW } },
  }) === NEW,
  "extract migrate id from nested error",
);
assert(extractMigrateToChatId(new Error("nope")) === undefined, "no migrate");

// 2) remapDealGroupChatId
const d1 = seedDeal({ id: "6a715f4f", groupChatId: OLD });
const remapped = remapDealGroupChatId(store, OLD, NEW);
assert(remapped?.id === "6a715f4f", "remap returns deal");
assert(store.get("6a715f4f")?.groupChatId === NEW, "store updated to NEW");
assert(
  store.findByGroupChatId(NEW)?.id === "6a715f4f",
  "findByGroupChatId(NEW)",
);
assert(store.findByGroupChatId(OLD) === undefined, "old id cleared");

// Reset for heal scenarios
store.update("6a715f4f", { groupChatId: OLD });

// 3) heal: getChat(old) → new id (classic Telegram behavior)
{
  const api = fakeApi(
    new Map([
      [OLD, { id: NEW, type: "supergroup", title: "Escrow #6a715f4f · 1 SOL" }],
      [NEW, { id: NEW, type: "supergroup", title: "Escrow #6a715f4f · 1 SOL" }],
    ]),
  );
  const healed = await healMigratedGroupDeal(api as never, store, NEW, SELLER);
  assert(healed?.id === "6a715f4f", "heal via getChat resolve");
  assert(store.get("6a715f4f")?.groupChatId === NEW, "healed store id");
}

store.update("6a715f4f", { groupChatId: OLD });

// 4) CRITICAL gap: getChat(old) still returns OLD (soft-stale) while updates use NEW
{
  const api = fakeApi(
    new Map([
      [OLD, { id: OLD, type: "group", title: "Escrow #6a715f4f · 1 SOL" }],
      [NEW, { id: NEW, type: "supergroup", title: "Escrow #6a715f4f · 1 SOL" }],
    ]),
  );
  // Direct find miss
  assert(
    store.findByGroupChatId(NEW) === undefined,
    "direct find misses on NEW before heal",
  );
  const healed = await findDealForGroupChat(api as never, store, NEW, SELLER);
  assert(
    healed?.id === "6a715f4f",
    "soft-stale + title/orphan heal must find deal for /wallet",
  );
  assert(healed?.groupChatId === NEW, "soft-stale remapped to NEW");
}

store.update("6a715f4f", { groupChatId: OLD });

// 5) Dead old id + single orphan party fallback
{
  const api = fakeApi(
    new Map([
      [OLD, "dead"],
      [NEW, { id: NEW, type: "supergroup", title: "c" }],
    ]),
  );
  const healed = await findDealForGroupChat(api as never, store, NEW, SELLER);
  assert(healed?.id === "6a715f4f", "dead orphan single-party heal");
  assert(healed?.groupChatId === NEW, "dead orphan remapped");
}

store.update("6a715f4f", { groupChatId: OLD });

// 6) Title fingerprint when soft-stale among noise
{
  seedDeal({
    id: "deadbeef",
    groupChatId: -999,
    creatorId: SELLER,
    buyerId: 3003,
    sellerId: SELLER,
    status: "awaiting_deposit",
  });
  const api = fakeApi(
    new Map([
      [OLD, { id: OLD, type: "group", title: "old" }],
      [-999, { id: -999, type: "supergroup", title: "other" }],
      [
        NEW,
        {
          id: NEW,
          type: "supergroup",
          title: "Escrow #6a715f4f · 1 SOL",
        },
      ],
    ]),
  );
  const healed = await findDealForGroupChat(api as never, store, NEW, SELLER);
  assert(healed?.id === "6a715f4f", "title match picks correct deal");
  assert(store.get("deadbeef")?.groupChatId === -999, "other deal untouched");
}

// Cleanup noise deal
store.update("deadbeef", {
  status: "cancelled",
  groupChatId: undefined,
});

rmSync(dir, { recursive: true, force: true });
console.log("check-group-chat-remap: OK");
