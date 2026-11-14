import { Bot, session } from "grammy";
import type { BotContext, SessionData } from "./context.js";
import { DealStore } from "./store/deals.js";
import { config } from "./config.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerCreateDealHandlers } from "./handlers/create-deal.js";
import { registerDealViewHandlers } from "./handlers/deals.js";
import { registerActionHandlers } from "./handlers/actions.js";
import { registerDisputeHandlers } from "./handlers/dispute.js";
import { it } from "./messages/it.js";

export function createBot(token: string): Bot<BotContext> {
  const store = new DealStore(config.dataDir);
  const bot = new Bot<BotContext>(token);

  bot.use(async (ctx, next) => {
    ctx.store = store;
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
  registerActionHandlers(bot);
  registerDisputeHandlers(bot);

  bot.catch((err) => {
    console.error("Errore bot:", err.error);
  });

  bot.on("message", async (ctx) => {
    if (ctx.session.creating) return;
    await ctx.reply(it.unknownCommand);
  });

  return bot;
}
