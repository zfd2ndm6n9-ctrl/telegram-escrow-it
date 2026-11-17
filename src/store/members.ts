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
  /** Username Telegram senza @ (obbligatorio per iscrizione soft). */
  username?: string;
  firstSeen: string;
  lastSeen: string;
  /** Quando l'utente ha confermato la @ (iscrizione completa). */
  registeredAt?: string;
  /** Codice invito riscattato (una volta). Attribuisce i deal creati. */
  inviteCode?: string;
  inviteRedeemedAt?: string;
};

type MemberStoreSnapshot = {
  members: Member[];
};

function nowIso(): string {
  return new Date().toISOString();
}

/** Normalizza handle: toglie @, trim, lowercase per lookup. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Iscritti JSON su disco (stesso pattern di DealStore).
 * Su Render: DATA_DIR su Persistent Disk (es. /var/data) → members.json.
 */
export class MemberStore {
  private members = new Map<number, Member>();
  /** username lowercase → userId */
  private byUsername = new Map<string, number>();
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

  /** Solo iscritti con @ confermata (o legacy con username già salvato). */
  get registeredCount(): number {
    return [...this.members.values()].filter((m) => this.isFullyRegistered(m))
      .length;
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MemberStoreSnapshot;
      for (const m of parsed.members ?? []) {
        if (typeof m.userId !== "number") continue;
        this.members.set(m.userId, m);
        if (m.username) {
          this.byUsername.set(normalizeUsername(m.username), m.userId);
        }
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

  private indexUsername(userId: number, username: string | undefined): void {
    // Rimuovi vecchi indici che puntano a questo userId
    for (const [uname, id] of this.byUsername) {
      if (id === userId) this.byUsername.delete(uname);
    }
    if (username) {
      this.byUsername.set(normalizeUsername(username), userId);
    }
  }

  get(userId: number): Member | undefined {
    return this.members.get(userId);
  }

  findByUsername(username: string): Member | undefined {
    const id = this.byUsername.get(normalizeUsername(username));
    if (id == null) return undefined;
    return this.members.get(id);
  }

  isFullyRegistered(member: Member): boolean {
    return Boolean(member.username?.trim());
  }

  /** Iscrizione soft completa: ha @ salvata. */
  isRegistered(userId: number): boolean {
    const m = this.members.get(userId);
    return Boolean(m && this.isFullyRegistered(m));
  }

  /**
   * Touch last_seen senza iscrivere (es. /start prima della @).
   * Non conta come iscritto finché manca username.
   */
  touch(userId: number, username?: string): Member {
    const ts = nowIso();
    const existing = this.members.get(userId);
    if (existing) {
      const next: Member = {
        ...existing,
        // Non sovrascrivere @ già confermata con undefined
        username: username ?? existing.username,
        lastSeen: ts,
      };
      this.members.set(userId, next);
      this.indexUsername(userId, next.username);
      this.persist();
      return next;
    }
    const member: Member = {
      userId,
      username: undefined,
      firstSeen: ts,
      lastSeen: ts,
    };
    this.members.set(userId, member);
    this.persist();
    return member;
  }

  /**
   * Conferma iscrizione con @.
   * Riconnette profilo esistente per userId o per username (stesso handle).
   * Se lo stesso @ era legato a un altro userId, restituisce `previousUserId`
   * così il caller può rimappare i deal.
   */
  registerWithUsername(
    userId: number,
    username: string,
  ): {
    member: Member;
    isNew: boolean;
    reconnected: boolean;
    previousUserId?: number;
  } {
    const ts = nowIso();
    const clean = username.trim().replace(/^@+/, "");
    if (!clean) {
      throw new Error("username vuoto");
    }
    const key = normalizeUsername(clean);

    const byId = this.members.get(userId);
    if (byId && this.isFullyRegistered(byId)) {
      const next: Member = {
        ...byId,
        username: clean,
        lastSeen: ts,
        registeredAt: byId.registeredAt ?? ts,
      };
      this.members.set(userId, next);
      this.indexUsername(userId, clean);
      this.persist();
      return { member: next, isNew: false, reconnected: true };
    }

    const byNameId = this.byUsername.get(key);
    if (byNameId != null && byNameId !== userId) {
      const old = this.members.get(byNameId)!;
      this.members.delete(byNameId);
      const next: Member = {
        ...old,
        userId,
        username: clean,
        lastSeen: ts,
        registeredAt: old.registeredAt ?? ts,
      };
      this.members.set(userId, next);
      this.indexUsername(userId, clean);
      this.persist();
      return {
        member: next,
        isNew: false,
        reconnected: true,
        previousUserId: byNameId,
      };
    }

    if (byId) {
      const next: Member = {
        ...byId,
        username: clean,
        lastSeen: ts,
        registeredAt: ts,
      };
      this.members.set(userId, next);
      this.indexUsername(userId, clean);
      this.persist();
      // Aveva già un record (touch) ma senza @: nuova iscrizione
      const isNew = !byId.registeredAt && !byId.username;
      return {
        member: next,
        isNew,
        reconnected: Boolean(byId.username),
      };
    }

    if (byNameId === userId) {
      const old = this.members.get(userId)!;
      const next: Member = {
        ...old,
        username: clean,
        lastSeen: ts,
        registeredAt: old.registeredAt ?? ts,
      };
      this.members.set(userId, next);
      this.indexUsername(userId, clean);
      this.persist();
      return { member: next, isNew: false, reconnected: true };
    }

    const member: Member = {
      userId,
      username: clean,
      firstSeen: ts,
      lastSeen: ts,
      registeredAt: ts,
    };
    this.members.set(userId, member);
    this.indexUsername(userId, clean);
    this.persist();
    return { member, isNew: true, reconnected: false };
  }

  /** @deprecated Preferire registerWithUsername; tenuto per compat. */
  upsertFromStart(
    userId: number,
    username?: string,
  ): { member: Member; isNew: boolean } {
    if (username) {
      const r = this.registerWithUsername(userId, username);
      return { member: r.member, isNew: r.isNew };
    }
    const before = this.members.has(userId);
    return { member: this.touch(userId), isNew: !before };
  }

  /** Più recenti per lastSeen (admin /iscritti). */
  listRecent(limit = 10): Member[] {
    return [...this.members.values()]
      .filter((m) => this.isFullyRegistered(m))
      .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
      .slice(0, Math.max(0, limit));
  }

  /**
   * Salva il codice invito sul membro (una sola volta).
   * Restituisce false se già aveva un codice diverso.
   */
  setInviteCode(
    userId: number,
    code: string,
  ): { ok: true; member: Member; already: boolean } | { ok: false } {
    const existing = this.members.get(userId);
    if (!existing) return { ok: false };
    const clean = code.trim().toUpperCase();
    if (existing.inviteCode) {
      return {
        ok: true,
        member: existing,
        already: existing.inviteCode === clean,
      };
    }
    const next: Member = {
      ...existing,
      inviteCode: clean,
      inviteRedeemedAt: nowIso(),
      lastSeen: nowIso(),
    };
    this.members.set(userId, next);
    this.persist();
    return { ok: true, member: next, already: false };
  }
}
