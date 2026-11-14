import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
 * Store persistente semplice su JSON (sufficiente per l'MVP).
 * Sostituibile in seguito con SQLite senza cambiare i handler.
 */
export class DealStore {
  private deals = new Map<string, Deal>();
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "deals.json");
    this.load();
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
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot, null, 2), "utf8");
    renameSync(tmp, this.filePath);
  }

  create(input: CreateDealInput): Deal {
    const ts = nowIso();
    const deal: Deal = {
      id: newDealId(),
      creatorId: input.creatorId,
      creatorUsername: input.creatorUsername,
      counterpartId: input.counterpartId,
      counterpartUsername: input.counterpartUsername,
      amount: input.amount,
      asset: input.asset,
      status: "pending_confirm",
      escrowAddress: input.escrowAddress,
      releaseVotes: [],
      refundVotes: [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.deals.set(deal.id, deal);
    this.persist();
    return deal;
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

  listForUser(userId: number): Deal[] {
    return [...this.deals.values()]
      .filter((d) => d.creatorId === userId || d.counterpartId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  findPendingForCounterpart(userId: number, username?: string): Deal[] {
    const uname = username?.replace(/^@/, "").toLowerCase();
    return [...this.deals.values()].filter((d) => {
      if (d.status !== "pending_confirm") return false;
      if (d.counterpartId === userId) return true;
      if (uname && d.counterpartUsername?.toLowerCase() === uname) return true;
      return false;
    });
  }
}
