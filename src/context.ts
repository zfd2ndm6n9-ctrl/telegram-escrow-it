import { Context, SessionFlavor } from "grammy";
import type { DealStore } from "./store/deals.js";
import type { PartyRole } from "./types.js";

export type CreateDealStep = "role" | "amount";

export interface SessionData {
  creating?: {
    step: CreateDealStep;
    role?: PartyRole;
    amount?: string;
  };
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    botUsername?: string;
  };
