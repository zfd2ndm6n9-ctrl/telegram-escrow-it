import { Bot, session } from "grammy";
import type { BotContext, SessionData } from "./context.js";
import { DealStore } from "./store/deals.js";
import { config } from "./config.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerCreateDealHandlers } from "./handlers/create-deal.js";
import { registerDealViewHandlers } from "./handlers/deals.js";
import { registerGroupHygieneHandlers } from "./handlers/group-hygiene.js";
import { registerGroupLifecycleHandlers } from "./handlers/group-lifecycle.js";
import { registerGroupCommandHandlers } from "./handlers/group-commands.js";
import { it } from "./messages/it.js";

export type CreatedBot = {
  bot: Bot<BotContext>;
  store: DealStore;
};

export function createBot(token: string): CreatedBot {
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
  registerGroupHygieneHandlers(bot);
  registerGroupLifecycleHandlers(bot);
  registerGroupCommandHandlers(bot);

  bot.catch((err) => {
    console.error("Errore bot:", err.error);
  });

  // Solo in privato: messaggio sconosciuto (non spammare i gruppi)
  bot.on("message:text", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    if (ctx.session.creating || ctx.session.termsQa) return;
    await ctx.reply(it.unknownPrivate);
  });

  return { bot, store };
}
