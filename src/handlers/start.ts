import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    // /start in gruppo arriva spesso da startgroup=payload
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      return;
    }

    try {
      await ctx.reply(it.welcome, {
        parse_mode: "Markdown",
        reply_markup: mainMenuKeyboard(),
      });
      console.log(`/start ok chat=${ctx.chat?.id} from=${ctx.from?.id}`);
    } catch (err) {
      console.error(
        `/start fail chat=${ctx.chat?.id} from=${ctx.from?.id}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  });

  bot.command("aiuto", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.help, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply(it.help, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.hears("❓ Aiuto", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    await ctx.reply(it.help, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });
}
