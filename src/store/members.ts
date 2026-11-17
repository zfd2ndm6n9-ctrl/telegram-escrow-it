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

export type Member = {
  userId: number;
  username?: string;
  firstSeen: string;
  lastSeen: string;
};

type MemberStoreSnapshot = {
  members: Member[];
};

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Iscritti JSON su disco (stesso pattern di DealStore).
 * Su Render: DATA_DIR su Persistent Disk (es. /var/data) → members.json.
 */
export class MemberStore {
  private members = new Map<number, Member>();
  private readonly filePath: string;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.filePath = resolve(this.dataDir, "members.json");
    this.load();
    console.log(
      `MemberStore: ${this.filePath} (${this.members.size} iscritti)`,
    );
  }

  get path(): string {
    return this.filePath;
  }

  get size(): number {
    return this.members.size;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MemberStoreSnapshot;
      for (const m of parsed.members ?? []) {
        if (typeof m.userId !== "number") continue;
        this.members.set(m.userId, m);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("Impossibile leggere lo store members:", err);
      }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot: MemberStoreSnapshot = {
      members: [...this.members.values()].sort((a, b) =>
        a.firstSeen.localeCompare(b.firstSeen),
      ),
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

  get(userId: number): Member | undefined {
    return this.members.get(userId);
  }

  isRegistered(userId: number): boolean {
    return this.members.has(userId);
  }

  /**
   * /start in privato: crea o aggiorna last_seen (+ username).
   * Idempotente: non doppio conteggio.
   */
  upsertFromStart(
    userId: number,
    username?: string,
  ): { member: Member; isNew: boolean } {
    const ts = nowIso();
    const existing = this.members.get(userId);
    if (existing) {
      const next: Member = {
        ...existing,
        username: username ?? existing.username,
        lastSeen: ts,
      };
      this.members.set(userId, next);
      this.persist();
      return { member: next, isNew: false };
    }
    const member: Member = {
      userId,
      username,
      firstSeen: ts,
      lastSeen: ts,
    };
    this.members.set(userId, member);
    this.persist();
    return { member, isNew: true };
  }

  /** Più recenti per lastSeen (admin /iscritti). */
  listRecent(limit = 10): Member[] {
    return [...this.members.values()]
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, Math.max(0, limit));
  }
}
