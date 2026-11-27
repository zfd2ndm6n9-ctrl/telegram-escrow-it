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
  /** Username Telegram senza @ (opzionale: soft gate per /crea). */
  username?: string;
  firstSeen: string;
  lastSeen: string;
  /**
   * Iscrizione completata (/start). Non richiede @.
   * Contatore pubblico e gate base usano questo.
   */
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

  /** Iscritti con /start completato (`registeredAt`, o legacy con @). */
  get registeredCount(): number {
    return [...this.members.values()].filter((m) => this.isFullyRegistered(m))
      .length;
  }

  /** Tutti i record (anche touch senza iscrizione). */
  listAll(): Member[] {
    return [...this.members.values()];
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
      const key = normalizeUsername(username);
      const prevOwner = this.byUsername.get(key);
      // Evita identità spezzata: se un altro membro aveva ancora questa @
      // sullo store, togli il campo (l'indice punta al nuovo userId).
      if (prevOwner != null && prevOwner !== userId) {
        const prev = this.members.get(prevOwner);
        if (prev?.username && normalizeUsername(prev.username) === key) {
          this.members.set(prevOwner, { ...prev, username: undefined });
        }
      }
      this.byUsername.set(key, userId);
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
    // Nuovo: registeredAt. Legacy: aveva solo @ senza registeredAt.
    return Boolean(member.registeredAt || member.username?.trim());
  }

  /** Iscrizione completata (/start), anche senza @. */
  isRegistered(userId: number): boolean {
    const m = this.members.get(userId);
    return Boolean(m && this.isFullyRegistered(m));
  }

  /** Soft gate: ha un @ Telegram salvato. */
  hasUsername(userId: number): boolean {
    const m = this.members.get(userId);
    return Boolean(m?.username?.trim());
  }

  /**
   * Touch last_seen (es. refresh). Non iscrive da solo.
   */
  touch(userId: number, username?: string): Member {
    const ts = nowIso();
    const existing = this.members.get(userId);
    if (existing) {
      const next: Member = {
        ...existing,
        // Non sovrascrivere @ già nota con undefined
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
      username: username || undefined,
      firstSeen: ts,
      lastSeen: ts,
    };
    this.members.set(userId, member);
    if (username) this.indexUsername(userId, username);
    this.persist();
    return member;
  }

  /**
   * Completa iscrizione a /start (con o senza @).
   * Riconnette per userId; se c’è @ e punta a un altro id, rimappa
   * (salvo blocco C1 via `allowProfileTransfer`).
   */
  registerFromStart(
    userId: number,
    username?: string,
    opts?: {
      allowProfileTransfer?: (previousUserId: number) => boolean;
    },
  ): {
    member: Member;
    isNew: boolean;
    reconnected: boolean;
    previousUserId?: number;
    reclaimBlocked?: boolean;
  } {
    const clean = username?.trim().replace(/^@+/, "") || undefined;
    if (clean) {
      return this.registerWithUsername(userId, clean, opts);
    }

    const ts = nowIso();
    const byId = this.members.get(userId);
    if (byId && this.isFullyRegistered(byId)) {
      const next: Member = {
        ...byId,
        lastSeen: ts,
        registeredAt: byId.registeredAt ?? ts,
      };
      this.members.set(userId, next);
      this.persist();
      return { member: next, isNew: false, reconnected: true };
    }

    if (byId) {
      const next: Member = {
        ...byId,
        lastSeen: ts,
        registeredAt: ts,
      };
      this.members.set(userId, next);
      this.persist();
      return { member: next, isNew: true, reconnected: false };
    }

    const member: Member = {
      userId,
      firstSeen: ts,
      lastSeen: ts,
      registeredAt: ts,
    };
    this.members.set(userId, member);
    this.persist();
    return { member, isNew: true, reconnected: false };
  }

  /**
   * Aggiorna @ da refresh periodico / getChat.
   * Restituisce true se username è cambiato.
   */
  refreshUsername(userId: number, username: string | undefined): boolean {
    const existing = this.members.get(userId);
    if (!existing) return false;
    const clean = username?.trim().replace(/^@+/, "") || undefined;
    const prev = existing.username?.trim() || undefined;
    if (prev === clean) {
      // solo lastSeen
      this.members.set(userId, { ...existing, lastSeen: nowIso() });
      this.persist();
      return false;
    }
    const next: Member = {
      ...existing,
      username: clean,
      lastSeen: nowIso(),
      registeredAt: existing.registeredAt ?? nowIso(),
    };
    this.members.set(userId, next);
    this.indexUsername(userId, clean);
    this.persist();
    return true;
  }

  /**
   * Conferma iscrizione con @.
   * Riconnette profilo esistente per userId o per username (stesso handle).
   * Se lo stesso @ era legato a un altro userId, restituisce `previousUserId`
   * così il caller può rimappare i deal idle/closed.
   *
   * `allowProfileTransfer(previousUserId)`: se false (es. deal protetti C1),
   * non cancella il vecchio membro né espone previousUserId — solo claim @
   * come iscrizione nuova. Ownership deal resta sul Telegram userId immutabile.
   */
  registerWithUsername(
    userId: number,
    username: string,
    opts?: {
      allowProfileTransfer?: (previousUserId: number) => boolean;
    },
  ): {
    member: Member;
    isNew: boolean;
    reconnected: boolean;
    previousUserId?: number;
    /** @ reclaim bloccato perché il precedente userId ha deal protetti. */
    reclaimBlocked?: boolean;
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
      const allow = opts?.allowProfileTransfer?.(byNameId) ?? true;
      if (!allow) {
        // C1 / churn: non rubare profilo né deal funded. Claim solo l'@.
        const old = this.members.get(byNameId);
        if (old?.username && normalizeUsername(old.username) === key) {
          this.members.set(byNameId, { ...old, username: undefined });
        }
        this.byUsername.delete(key);

        if (byId) {
          const next: Member = {
            ...byId,
            username: clean,
            lastSeen: ts,
            registeredAt: byId.registeredAt ?? ts,
          };
          this.members.set(userId, next);
          this.indexUsername(userId, clean);
          this.persist();
          return {
            member: next,
            isNew: !byId.registeredAt,
            reconnected: false,
            reclaimBlocked: true,
          };
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
        return {
          member,
          isNew: true,
          reconnected: false,
          reclaimBlocked: true,
        };
      }

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

  /** Display: @handle oppure «utente». */
  displayHandle(userId: number): string {
    const m = this.members.get(userId);
    return m?.username?.trim() ? `@${m.username.trim()}` : "utente";
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
