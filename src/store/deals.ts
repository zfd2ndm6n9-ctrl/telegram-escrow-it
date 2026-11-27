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
      inviteCode: input.inviteCode,
      collaboratorUserId: input.collaboratorUserId,
      collaboratorWallet: input.collaboratorWallet,
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

  /**
   * Sceglie un deal in setup gruppo tra i candidati.
   * Con `chatId`: non restituisce mai un deal già bound a un *altro* gruppo;
   * preferisce bound a questo chat, poi unbound (`groupChatId` assente).
   */
  private pickAwaitingGroupDeal(
    candidates: Deal[],
    chatId?: number,
  ): Deal | undefined {
    let list = candidates;
    if (chatId != null) {
      list = list.filter(
        (d) => d.groupChatId == null || d.groupChatId === chatId,
      );
    }
    if (list.length === 0) return undefined;

    const byUpdated = (a: Deal, b: Deal) =>
      b.updatedAt.localeCompare(a.updatedAt);

    if (chatId != null) {
      const boundHere = list
        .filter((d) => d.groupChatId === chatId)
        .sort(byUpdated);
      if (boundHere[0]) return boundHere[0];
    }

    const unbound = list.filter((d) => d.groupChatId == null).sort(byUpdated);
    if (unbound[0]) return unbound[0];

    return [...list].sort(byUpdated)[0];
  }

  private isAwaitingGroupStatus(status: DealStatus): boolean {
    return (
      status === "awaiting_group" ||
      status === "awaiting_bot_admin" ||
      status === "awaiting_counterpart"
    );
  }

  /**
   * Deal del creator ancora da avviare / in setup gruppo.
   * @param chatId gruppo corrente: esclude deal già collegati ad altri chat.
   */
  findAwaitingGroupByCreator(
    creatorId: number,
    chatId?: number,
  ): Deal | undefined {
    const candidates = [...this.deals.values()].filter(
      (d) => d.creatorId === creatorId && this.isAwaitingGroupStatus(d.status),
    );
    return this.pickAwaitingGroupDeal(candidates, chatId);
  }

  /**
   * Deal in attesa di gruppo/bind dove `userId` è creator, buyer o seller.
   * Consente /avvia anche alla controparte (non solo al DM opener).
   * @param chatId gruppo corrente: esclude deal già collegati ad altri chat
   *   (evita «già collegato» quando si apre un secondo deal con lo stesso amico).
   */
  findAwaitingGroupByParty(
    userId: number,
    chatId?: number,
  ): Deal | undefined {
    const candidates = [...this.deals.values()].filter(
      (d) =>
        (d.creatorId === userId ||
          d.buyerId === userId ||
          d.sellerId === userId) &&
        this.isAwaitingGroupStatus(d.status),
    );
    return this.pickAwaitingGroupDeal(candidates, chatId);
  }

  listForUser(userId: number): Deal[] {
    return [...this.deals.values()]
      .filter(
        (d) =>
          d.creatorId === userId || d.buyerId === userId || d.sellerId === userId,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Deal conclusi (rilasciati / rimborsati) per «I miei deal». */
  listConcludedForUser(userId: number): Deal[] {
    return [...this.deals.values()]
      .filter(
        (d) =>
          (d.creatorId === userId ||
            d.buyerId === userId ||
            d.sellerId === userId) &&
          (d.status === "released" || d.status === "refunded"),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Svuota lo store in memoria e su disco (`deals.json` → `{ deals: [] }`).
   * Non tocca escrow on-chain. Usato da `/admin_wipe_deals`.
   */
  clearAll(): number {
    const n = this.deals.size;
    this.deals.clear();
    this.persist();
    return n;
  }

  listByStatus(status: DealStatus): Deal[] {
    return [...this.deals.values()].filter((d) => d.status === status);
  }

  /** Tutti i deal nello store (recovery bulk / audit). */
  listAll(): Deal[] {
    return [...this.deals.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  /**
   * Deal con fondi, lock deposito o voti dual-confirm: non rimappare su un
   * nuovo Telegram userId solo perché un `@` abbandonato è stato ripreso (C1).
   */
  isRemapProtected(deal: Deal): boolean {
    if (
      deal.status === "awaiting_deposit" ||
      deal.status === "funded" ||
      deal.status === "release_pending" ||
      deal.status === "refund_pending" ||
      deal.status === "disputed"
    ) {
      return true;
    }
    if ((deal.releaseVotes?.length ?? 0) > 0) return true;
    if ((deal.refundVotes?.length ?? 0) > 0) return true;
    if (deal.depositLamports != null && deal.depositLamports !== "") return true;
    if (deal.depositDetectedAt) return true;
    return false;
  }

  /** True se userId è creator/buyer/seller di almeno un deal protetto dal remap. */
  userOwnsRemapProtectedDeals(userId: number): boolean {
    for (const deal of this.deals.values()) {
      if (!this.isRemapProtected(deal)) continue;
      if (
        deal.creatorId === userId ||
        deal.buyerId === userId ||
        deal.sellerId === userId
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Riconnessione membro: se Telegram userId cambia ma la @ è la stessa,
   * aggiorna creator/buyer/seller id sui deal *idle/closed* collegati.
   * Mai sui deal protetti (fondi / deposito atteso / voti / disputa).
   */
  remapUserId(previousUserId: number, newUserId: number): number {
    if (previousUserId === newUserId) return 0;
    let n = 0;
    let skipped = 0;
    for (const deal of this.deals.values()) {
      const touches =
        deal.creatorId === previousUserId ||
        deal.buyerId === previousUserId ||
        deal.sellerId === previousUserId;
      if (!touches) continue;
      if (this.isRemapProtected(deal)) {
        skipped += 1;
        continue;
      }
      const patch: Partial<Deal> = {};
      if (deal.creatorId === previousUserId) patch.creatorId = newUserId;
      if (deal.buyerId === previousUserId) patch.buyerId = newUserId;
      if (deal.sellerId === previousUserId) patch.sellerId = newUserId;
      if (Object.keys(patch).length === 0) continue;
      const next: Deal = {
        ...deal,
        ...patch,
        updatedAt: nowIso(),
      };
      this.deals.set(deal.id, next);
      n += 1;
    }
    if (n > 0) this.persist();
    if (skipped > 0) {
      console.warn(
        `remapUserId ${previousUserId}→${newUserId}: remapped=${n} skipped_protected=${skipped}`,
      );
    }
    return n;
  }
}
