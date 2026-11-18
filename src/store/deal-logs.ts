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

/** Cap per deal (MVP dispute support). */
export const DEAL_LOG_MAX_ENTRIES = 200;
/** Max caratteri testo trattenuto per voce. */
export const DEAL_LOG_MAX_TEXT = 800;
/** Giorni di retention dopo l’ultima voce (privacy). */
export const DEAL_LOG_RETENTION_DAYS = 30;

export type DealLogKind = "user" | "event";

export type DealLogEntry = {
  at: string;
  kind: DealLogKind;
  /** Testo utente o descrizione evento. */
  text: string;
  fromId?: number;
  username?: string;
  role?: "buyer" | "seller" | "admin" | "other";
  messageId?: number;
  /** true se il bot ha cancellato questo messaggio (igiene). */
  deletedByBot?: boolean;
};

type DealLogBucket = {
  dealId: string;
  updatedAt: string;
  entries: DealLogEntry[];
};

type DealLogSnapshot = {
  logs: DealLogBucket[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function clampText(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= DEAL_LOG_MAX_TEXT) return t;
  return `${t.slice(0, DEAL_LOG_MAX_TEXT - 1)}…`;
}

/**
 * Log messaggi parte + eventi chiave per deal (dispute support).
 * Non salva prompt effimeri del bot. Cap size/età — vedi README.
 * File: `deal-logs.json` in DATA_DIR.
 */
export class DealLogStore {
  private buckets = new Map<string, DealLogBucket>();
  private readonly filePath: string;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.filePath = resolve(this.dataDir, "deal-logs.json");
    this.load();
    this.pruneExpired();
    console.log(
      `DealLogStore: ${this.filePath} (${this.buckets.size} deal con log)`,
    );
  }

  get path(): string {
    return this.filePath;
  }

  /** Numero di deal con almeno un log (per anteprima wipe). */
  get size(): number {
    return this.buckets.size;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DealLogSnapshot;
      for (const b of parsed.logs ?? []) {
        if (!b?.dealId || !Array.isArray(b.entries)) continue;
        this.buckets.set(b.dealId, {
          dealId: b.dealId,
          updatedAt: b.updatedAt || nowIso(),
          entries: b.entries,
        });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("Impossibile leggere deal-logs:", err);
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot: DealLogSnapshot = {
      logs: [...this.buckets.values()],
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

  private getOrCreate(dealId: string): DealLogBucket {
    let b = this.buckets.get(dealId);
    if (!b) {
      b = { dealId, updatedAt: nowIso(), entries: [] };
      this.buckets.set(dealId, b);
    }
    return b;
  }

  private push(dealId: string, entry: DealLogEntry): void {
    const b = this.getOrCreate(dealId);
    b.entries.push(entry);
    if (b.entries.length > DEAL_LOG_MAX_ENTRIES) {
      b.entries = b.entries.slice(-DEAL_LOG_MAX_ENTRIES);
    }
    b.updatedAt = entry.at;
    this.persist();
  }

  /** Messaggio testo da buyer/seller nel gruppo deal. */
  appendUserMessage(
    dealId: string,
    opts: {
      text: string;
      fromId: number;
      username?: string;
      role?: DealLogEntry["role"];
      messageId?: number;
    },
  ): void {
    const text = clampText(opts.text);
    if (!text) return;
    this.push(dealId, {
      at: nowIso(),
      kind: "user",
      text,
      fromId: opts.fromId,
      username: opts.username,
      role: opts.role,
      messageId: opts.messageId,
    });
  }

  /** Evento chiave deal (disputa, consegnato, wallet, payout, …). */
  appendEvent(dealId: string, text: string): void {
    const t = clampText(text);
    if (!t) return;
    this.push(dealId, {
      at: nowIso(),
      kind: "event",
      text: t,
    });
  }

  /** Marca un messaggio già loggato come cancellato dal bot (igiene). */
  markDeletedByBot(dealId: string, messageId: number): void {
    const b = this.buckets.get(dealId);
    if (!b) return;
    let changed = false;
    for (let i = b.entries.length - 1; i >= 0; i--) {
      const e = b.entries[i];
      if (e?.kind === "user" && e.messageId === messageId && !e.deletedByBot) {
        e.deletedByBot = true;
        changed = true;
        break;
      }
    }
    if (changed) {
      b.updatedAt = nowIso();
      this.persist();
    }
  }

  getEntries(dealId: string): DealLogEntry[] {
    return [...(this.buckets.get(dealId)?.entries ?? [])];
  }

  /**
   * Transcript per admin `/log`: messaggi parte + eventi chiave in ordine.
   * `[del]` = cancellato dal bot (igiene). Bot API non vede delete utente:
   * tratteniamo la copia locale al receive.
   */
  formatTranscript(dealId: string): string | null {
    const entries = this.getEntries(dealId);
    if (entries.length === 0) return null;

    const lines: string[] = [];
    for (const e of entries) {
      const time = e.at.slice(11, 19); // HH:MM:SS UTC
      if (e.kind === "event") {
        lines.push(`• [${time}] ${e.text}`);
        continue;
      }
      const who = e.username
        ? `@${e.username}`
        : e.fromId != null
          ? `id:${e.fromId}`
          : "?";
      const role = e.role ? ` (${e.role})` : "";
      const flag = e.deletedByBot ? " [del]" : "";
      lines.push(`• [${time}] ${who}${role}${flag}: ${e.text}`);
    }
    return lines.join("\n");
  }

  /** Rimuove bucket non aggiornati da > RETENTION_DAYS. */
  pruneExpired(now = Date.now()): number {
    const maxAgeMs = DEAL_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [id, b] of this.buckets) {
      const t = Date.parse(b.updatedAt);
      if (!Number.isFinite(t) || now - t > maxAgeMs) {
        this.buckets.delete(id);
        removed++;
      }
    }
    if (removed > 0) this.persist();
    return removed;
  }

  /**
   * Svuota tutti i transcript (`deal-logs.json` → `{ logs: [] }`).
   * Usato da `/admin_wipe_deals` insieme allo store deal.
   */
  clearAll(): number {
    const n = this.buckets.size;
    this.buckets.clear();
    this.persist();
    return n;
  }
}
