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

export type InviteRedemption = {
  userId: number;
  username?: string;
  redeemedAt: string;
};

export type InviteCode = {
  /** Codice breve maiuscolo (es. ESC-A1B2C3) */
  code: string;
  collaboratorUserId: number;
  collaboratorUsername?: string;
  /** Indirizzo SOL per la quota 2.5% */
  collaboratorWallet: string;
  createdAt: string;
  createdByAdminId: number;
  active: boolean;
  redemptions: InviteRedemption[];
};

type InviteStoreSnapshot = {
  invites: InviteCode[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/^#/, "");
}

/**
 * Codici di test soft-launch da non riusare in prod/staging.
 * Restano inattivi anche se ancora presenti su `invites.json` del disco.
 */
export const RETIRED_INVITE_CODES = new Set(["KEYTEST", "TESTKEY"]);

export function isRetiredInviteCode(raw: string): boolean {
  return RETIRED_INVITE_CODES.has(normalizeCode(raw));
}

/** Genera codice leggibile: ESC-XXXXXX */
function newInviteCode(): string {
  const body = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `ESC-${body}`;
}

/**
 * Codici invito collaboratori su disco (DATA_DIR/invites.json).
 * Stesso pattern atomico di deals/members.
 */
export class InviteStore {
  private invites = new Map<string, InviteCode>();
  private readonly filePath: string;
  readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.filePath = resolve(this.dataDir, "invites.json");
    this.load();
    console.log(
      `InviteStore: ${this.filePath} (${this.invites.size} codici)`,
    );
  }

  get path(): string {
    return this.filePath;
  }

  get size(): number {
    return this.invites.size;
  }

  private load(): void {
    let retiredTouched = false;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as InviteStoreSnapshot;
      for (const inv of parsed.invites ?? []) {
        if (!inv?.code) continue;
        const code = normalizeCode(inv.code);
        const retired = RETIRED_INVITE_CODES.has(code);
        const active = retired ? false : inv.active !== false;
        if (retired && inv.active !== false) {
          retiredTouched = true;
          console.warn(
            `InviteStore: codice ritirato disattivato → ${code}`,
          );
        }
        this.invites.set(code, {
          ...inv,
          code,
          redemptions: inv.redemptions ?? [],
          active,
        });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("Impossibile leggere lo store invites:", err);
      }
    }
    if (retiredTouched) {
      this.persist();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot: InviteStoreSnapshot = {
      invites: [...this.invites.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
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

  get(code: string): InviteCode | undefined {
    return this.invites.get(normalizeCode(code));
  }

  /**
   * Elenco codici. Default: solo *attivi* (soft-launch /codici).
   * Passa `includeInactive: true` per audit (off + ritirati).
   */
  list(
    limit = 50,
    opts?: { includeInactive?: boolean },
  ): InviteCode[] {
    const includeInactive = opts?.includeInactive === true;
    return [...this.invites.values()]
      .filter((inv) => includeInactive || inv.active)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  }

  /**
   * Crea un codice nuovo, oppure riattiva/aggiorna uno *inattivo* esistente
   * (stesso nome: es. CVVBYPASS dopo /codiceoff).
   * Codice *attivo* già presente → errore «già esistente».
   */
  create(input: {
    collaboratorUserId: number;
    collaboratorUsername?: string;
    collaboratorWallet: string;
    createdByAdminId: number;
    code?: string;
  }): InviteCode & { reactivated?: boolean } {
    let code = input.code ? normalizeCode(input.code) : newInviteCode();
    if (input.code && RETIRED_INVITE_CODES.has(code)) {
      throw new Error(
        `Codice ritirato (non riutilizzabile): ${code}. Scegline un altro.`,
      );
    }
    const existing = this.invites.get(code);
    if (existing) {
      if (input.code && !existing.active) {
        return this.reactivate(code, {
          collaboratorUserId: input.collaboratorUserId,
          collaboratorUsername: input.collaboratorUsername,
          collaboratorWallet: input.collaboratorWallet,
          createdByAdminId: input.createdByAdminId,
        });
      }
      if (input.code) {
        throw new Error(`Codice già esistente: ${code}`);
      }
      // Collision unlikely; regenerate once
      code = newInviteCode();
      if (this.invites.has(code)) {
        code = `ESC-${randomBytes(5).toString("hex").toUpperCase()}`;
      }
    }

    const invite: InviteCode = {
      code,
      collaboratorUserId: input.collaboratorUserId,
      collaboratorUsername: input.collaboratorUsername,
      collaboratorWallet: input.collaboratorWallet.trim(),
      createdAt: nowIso(),
      createdByAdminId: input.createdByAdminId,
      active: true,
      redemptions: [],
    };
    this.invites.set(code, invite);
    this.persist();
    return invite;
  }

  /**
   * Riattiva un codice off e aggiorna wallet + collab.
   * Conserva `createdAt` / `redemptions`. Ritirati (KEYTEST) → errore.
   */
  reactivate(
    code: string,
    patch: {
      collaboratorUserId?: number;
      collaboratorUsername?: string;
      collaboratorWallet?: string;
      createdByAdminId?: number;
    } = {},
  ): InviteCode & { reactivated: true } {
    const key = normalizeCode(code);
    if (RETIRED_INVITE_CODES.has(key)) {
      throw new Error(
        `Codice ritirato (non riutilizzabile): ${key}. Scegline un altro.`,
      );
    }
    const invite = this.invites.get(key);
    if (!invite) {
      throw new Error(`Codice non trovato: ${key}`);
    }
    const next: InviteCode = {
      ...invite,
      active: true,
      collaboratorUserId:
        patch.collaboratorUserId ?? invite.collaboratorUserId,
      collaboratorUsername:
        patch.collaboratorUsername !== undefined
          ? patch.collaboratorUsername
          : invite.collaboratorUsername,
      collaboratorWallet: patch.collaboratorWallet
        ? patch.collaboratorWallet.trim()
        : invite.collaboratorWallet,
      createdByAdminId: patch.createdByAdminId ?? invite.createdByAdminId,
    };
    this.invites.set(key, next);
    this.persist();
    return { ...next, reactivated: true };
  }

  /**
   * Riscatta un codice per un utente. Idempotente se già riscattato lo stesso codice.
   * Un utente può avere un solo codice attivo (il primo).
   */
  redeem(
    code: string,
    userId: number,
    username?: string,
  ):
    | { ok: true; invite: InviteCode; already: boolean }
    | {
        ok: false;
        reason: "not_found" | "inactive" | "already_other";
      } {
    const key = normalizeCode(code);
    const invite = this.invites.get(key);
    if (!invite) return { ok: false, reason: "not_found" };
    if (!invite.active) return { ok: false, reason: "inactive" };

    const alreadyHere = invite.redemptions.some((r) => r.userId === userId);
    if (alreadyHere) {
      return { ok: true, invite, already: true };
    }

    // Controlla se l'utente ha già un altro codice (via scan)
    for (const other of this.invites.values()) {
      if (other.code === invite.code) continue;
      if (other.redemptions.some((r) => r.userId === userId)) {
        return { ok: false, reason: "already_other" };
      }
    }

    invite.redemptions.push({
      userId,
      username,
      redeemedAt: nowIso(),
    });
    this.invites.set(key, invite);
    this.persist();
    return { ok: true, invite, already: false };
  }

  /** Codice riscattato da userId (se presente). */
  findRedeemedByUser(userId: number): InviteCode | undefined {
    for (const invite of this.invites.values()) {
      if (invite.redemptions.some((r) => r.userId === userId)) {
        return invite;
      }
    }
    return undefined;
  }

  setActive(code: string, active: boolean): InviteCode | undefined {
    const key = normalizeCode(code);
    const invite = this.invites.get(key);
    if (!invite) return undefined;
    const next = { ...invite, active };
    this.invites.set(key, next);
    this.persist();
    return next;
  }
}
