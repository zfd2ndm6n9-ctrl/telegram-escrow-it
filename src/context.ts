import { Context, SessionFlavor } from "grammy";
import type { DealStore } from "./store/deals.js";

export type CreateDealStep = "amount" | "counterpart";

export interface SessionData {
  creating?: {
    step: CreateDealStep;
    amount?: string;
  };
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    botUsername?: string;
  };
