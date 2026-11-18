import { Context, SessionFlavor } from "grammy";
import type { DealLogStore } from "./store/deal-logs.js";
import type { DealStore } from "./store/deals.js";
import type { InviteStore } from "./store/invites.js";
import type { MemberStore } from "./store/members.js";
import type { Asset, DmTermsStep, PartyRole } from "./types.js";

export type CreateDealStep = "role" | "asset";

export interface SessionData {
  creating?: {
    step: CreateDealStep;
    role?: PartyRole;
    asset?: Asset;
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
  /** Dopo iscrizione: in attesa di codice invito opzionale. */
  awaitingInviteCode?: boolean;
  /** Message id del prompt «Codice invito?» (+ bottone Nessun codice). */
  invitePromptMessageId?: number;
  /**
   * Messaggi effimeri invito (errori + risposte utente).
   * Cancellati a skip/riscatto ok.
   */
  inviteEphemeralIds?: number[];
  /** Codice invito da deep-link `/start invito_CODE` (applicato dopo @). */
  pendingInviteCode?: string;
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    members: MemberStore;
    invites: InviteStore;
    dealLogs: DealLogStore;
    botUsername?: string;
  };
