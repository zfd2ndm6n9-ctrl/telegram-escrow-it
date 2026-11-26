import { Bot, session } from "grammy";
import type { BotContext, SessionData } from "./context.js";
import { DealLogStore } from "./store/deal-logs.js";
import { DealStore } from "./store/deals.js";
import { InviteStore } from "./store/invites.js";
import { MemberStore } from "./store/members.js";
import { config } from "./config.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerCreateDealHandlers } from "./handlers/create-deal.js";
import { registerDealViewHandlers } from "./handlers/deals.js";
import { registerFeedbackHandlers } from "./handlers/feedback.js";
import { registerGroupHygieneHandlers } from "./handlers/group-hygiene.js";
import { registerGroupLifecycleHandlers } from "./handlers/group-lifecycle.js";
import { registerGroupCommandHandlers } from "./handlers/group-commands.js";
import { setGroupCompromiseDealLogs } from "./services/group-compromise.js";
import { deleteMessageSafe } from "./services/prompt-cleanup.js";

export type CreatedBot = {
  bot: Bot<BotContext>;
  store: DealStore;
  members: MemberStore;
  invites: InviteStore;
  dealLogs: DealLogStore;
};

export function createBot(token: string): CreatedBot {
  const store = new DealStore(config.dataDir);
  const members = new MemberStore(config.dataDir);
  const invites = new InviteStore(config.dataDir);
  const dealLogs = new DealLogStore(config.dataDir);
  setGroupCompromiseDealLogs(dealLogs);
  const bot = new Bot<BotContext>(token);

  bot.use(async (ctx, next) => {
    ctx.store = store;
    ctx.members = members;
    ctx.invites = invites;
    ctx.dealLogs = dealLogs;
    ctx.botUsername = config.botUsername;
    await next();
  });

  bot.use(
    session({
      initial: (): SessionData => ({}),
    }),
  );

  registerStartHandlers(bot);
  registerCreateDealHandlers(bot);
  registerDealViewHandlers(bot);
  registerFeedbackHandlers(bot);
  registerGroupHygieneHandlers(bot);
  registerGroupLifecycleHandlers(bot);
  registerGroupCommandHandlers(bot);

  bot.catch((err) => {
    console.error("Errore bot:", err.error);
  });

  // Solo in privato, fuori wizard: free text non valido → cancella, silenzio.
  // Button-only (menu inline): niente «Non ho capito…».
  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    if (
      ctx.session.creating ||
      ctx.session.termsQa ||
      ctx.session.awaitingHandle ||
      ctx.session.awaitingInviteCode ||
      ctx.session.awaitingFeedback
    ) {
      return;
    }
    const mid = ctx.message?.message_id;
    if (mid != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, mid);
    }
  });

  return { bot, store, members, invites, dealLogs };
}
