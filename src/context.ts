import { Context, SessionFlavor } from "grammy";
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
  /**
   * Wizard termini in DM (seller): deal attivo + step corrente.
   * Usato anche quando il seller non è il creator (/avvia → DM).
   */
  termsQa?: {
    dealId: string;
    step: DmTermsStep;
  };
  /** Soft signup: in attesa della @ dopo /start. */
  awaitingHandle?: boolean;
  /** Message id della domanda «Invia la tua @» (igiene Q/A). */
  signupPromptMessageId?: number;
  /** Dopo iscrizione: in attesa di codice invito opzionale. */
  awaitingInviteCode?: boolean;
  /** Codice invito da deep-link `/start invito_CODE` (applicato dopo @). */
  pendingInviteCode?: string;
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    members: MemberStore;
    invites: InviteStore;
    botUsername?: string;
  };
