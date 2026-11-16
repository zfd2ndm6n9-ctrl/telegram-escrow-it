import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { CreateDealInput, Deal, DealStatus } from "../types.js";

type DealStoreSnapshot = {
  deals: Deal[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function newDealId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Store JSON su disco (MVP). Chiave principale: id deal; lookup per groupChatId / creator.
 * Su Render: montare un Persistent Disk e impostare DATA_DIR sul mount (es. /var/data),
 * altrimenti il filesystem ephemeral azzera i deal a ogni redeploy.
 */
export class DealStore {
  private deals = new Map<string, Deal>();
  private readonly filePath: string;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.filePath = resolve(this.dataDir, "deals.json");
    this.load();
    console.log(
      `DealStore: ${this.filePath} (${this.deals.size} deal caricati)`,
    );
  }

  get path(): string {
    return this.filePath;
  }

  get size(): number {
    return this.deals.size;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DealStoreSnapshot;
      for (const deal of parsed.deals ?? []) {
        this.deals.set(deal.id, deal);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("Impossibile leggere lo store deals:", err);
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot: DealStoreSnapshot = {
      deals: [...this.deals.values()],
    };
    const payload = `${JSON.stringify(snapshot, null, 2)}\n`;
    const tmp = `${this.filePath}.tmp`;
    const fd = openSync(tmp, "w");
    try {
      writeFileSync(fd, payload, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, this.filePath);
  }

  create(input: CreateDealInput): Deal {
    const ts = nowIso();
    const deal: Deal = {
      id: newDealId(),
      creatorId: input.creatorId,
      creatorUsername: input.creatorUsername,
      creatorRole: input.creatorRole,
      amount: input.amount ?? "",
      asset: input.asset,
      status: "awaiting_group",
      escrowAddress: input.escrowAddress,
      releaseVotes: [],
      refundVotes: [],
      amountVotes: [],
      botPromptIds: [],
      createdAt: ts,
      updatedAt: ts,
    };

    if (input.creatorRole === "buyer") {
      deal.buyerId = input.creatorId;
      deal.buyerUsername = input.creatorUsername;
      deal.buyerDisplayName = input.creatorDisplayName;
    } else {
      deal.sellerId = input.creatorId;
      deal.sellerUsername = input.creatorUsername;
      deal.sellerDisplayName = input.creatorDisplayName;
    }

    this.deals.set(deal.id, deal);
    this.persist();
    return deal;
  }

  /**
   * Inserisce o sostituisce un deal (recovery / seed). Conserva `id` del record passato.
   */
  upsert(deal: Deal): Deal {
    const next: Deal = {
      ...deal,
      updatedAt: nowIso(),
    };
    this.deals.set(next.id, next);
    this.persist();
    return next;
  }

  get(id: string): Deal | undefined {
    return this.deals.get(id);
  }

  update(id: string, patch: Partial<Deal>): Deal | undefined {
    const current = this.deals.get(id);
    if (!current) return undefined;
    const next: Deal = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: nowIso(),
    };
    this.deals.set(id, next);
    this.persist();
    return next;
  }

  setStatus(id: string, status: DealStatus): Deal | undefined {
    return this.update(id, { status });
  }

  findByGroupChatId(chatId: number): Deal | undefined {
    return [...this.deals.values()].find((d) => d.groupChatId === chatId);
  }

  /** Deal del creator ancora da avviare / in setup gruppo (il più recente). */
  findAwaitingGroupByCreator(creatorId: number): Deal | undefined {
    return [...this.deals.values()]
      .filter(
        (d) =>
          d.creatorId === creatorId &&
          (d.status === "awaiting_group" ||
            d.status === "awaiting_bot_admin" ||
            d.status === "awaiting_counterpart"),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  /**
   * Deal in attesa di gruppo/bind dove `userId` è creator, buyer o seller.
   * Consente /avvia anche alla controparte (non solo al DM opener).
   */
  findAwaitingGroupByParty(userId: number): Deal | undefined {
    return [...this.deals.values()]
      .filter(
        (d) =>
          (d.creatorId === userId ||
            d.buyerId === userId ||
            d.sellerId === userId) &&
          (d.status === "awaiting_group" ||
            d.status === "awaiting_bot_admin" ||
            d.status === "awaiting_counterpart"),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  listForUser(userId: number): Deal[] {
    return [...this.deals.values()]
      .filter(
        (d) =>
          d.creatorId === userId || d.buyerId === userId || d.sellerId === userId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listByStatus(status: DealStatus): Deal[] {
    return [...this.deals.values()].filter((d) => d.status === status);
  }
}
