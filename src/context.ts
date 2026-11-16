import { Context, SessionFlavor } from "grammy";
import type { DealStore } from "./store/deals.js";
import type { Asset, PartyRole } from "./types.js";

export type CreateDealStep = "role" | "asset";

export interface SessionData {
  creating?: {
    step: CreateDealStep;
    role?: PartyRole;
    asset?: Asset;
  };
}

export type BotContext = Context &
  SessionFlavor<SessionData> & {
    store: DealStore;
    botUsername?: string;
  };
