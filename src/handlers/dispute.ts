import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import { openDispute } from "./actions.js";

export function registerDisputeHandlers(bot: Bot<BotContext>): void {
  bot.command("dispute", async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply(it.needDealId);
      return;
    }
    await openDispute(ctx, id);
  });
}
