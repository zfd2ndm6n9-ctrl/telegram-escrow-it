import { Context, SessionFlavor } from "grammy";
import type { DealLogStore } from "./store/deal-logs.js";
import type { DealStore } from "./store/deals.js";
import type { InviteStore } from "./store/invites.js";
import type { MemberStore } from "./store/members.js";
import type { Asset, DmTermsStep, PartyRole } from "./types.js";

export type CreateDealStep = "invite" | "role" | "asset";

export interface SessionData {
  creating?: {
    step: CreateDealStep;
    role?: PartyRole;
    asset?: Asset;
    /** Snapshot invito opzionale per *questo* deal (da step /crea). */
    inviteCode?: string;
    collaboratorUserId?: number;
    collaboratorWallet?: string;
  };
  /** Messaggi effimeri /crea (ruolo, crypto, risposte) da cancellare a fine step. */
  creatingEphemeralIds?: number[];
  /**
   * Wizard termini in DM (opener dopo /crea): deal attivo + step corrente.
   * «Proponi i ToS» chiede le 3 Q nel gruppo, non qui.
   */
  termsQa?: {
    dealId: string;
    step: DmTermsStep;
  };
  /** Soft signup: in attesa della @ dopo /start. */
  awaitingHandle?: boolean;
  /** Message id della domanda «Invia la tua @» (igiene Q/A). */
  signupPromptMessageId?: number;
  /**
   * Messaggi effimeri signup (@ errata, mismatch, risposte utente invalide).
   * Cancellati al successo o quando si ripete la domanda.
   */
  signupEphemeralIds?: number[];
  /** Durante /crea: in attesa di codice invito opzionale (non su /start). */
  awaitingInviteCode?: boolean;
  /** Message id del prompt «Codice invito?» (+ bottone Nessun codice). */
  invitePromptMessageId?: number;
  /**
   * Messaggi effimeri invito (errori + risposte utente).
   * Cancellati a skip/riscatto ok.
   */
  inviteEphemeralIds?: number[];
  /**
   * Codice invito da deep-link `/start invito_CODE`
   * (applicato al prossimo /crea).
   */
  pendingInviteCode?: string;
  /** Deep-link `/start crea`: dopo iscrizione/vouch avvia /crea. */
  pendingCrea?: boolean;
  /** Ultimo messaggio lista `/miei` (delete+repost, no stack). */
  mieiListMessageId?: number;
  /** Echo utente `/miei` o «I miei deal» (cancellato al prossimo /miei). */
  mieiUserCommandMessageId?: number;
  /**
   * Messaggi errore wizard termini DM (prezzo/corto) da cancellare
   * al prossimo step valido.
   */
  termsErrorMessageIds?: number[];
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    members: MemberStore;
    invites: InviteStore;
    dealLogs: DealLogStore;
    botUsername?: string;
  };
