import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it, statusLabel } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { dismissInviteStep } from "./start.js";

export function registerDealViewHandlers(bot: Bot<BotContext>): void {
  const listDeals = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.onlyPrivate, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;
    await dismissInviteStep(ctx);
    // Solo conclusi (released / refunded): i deal aperti vivono nel gruppo.
    const deals = ctx.store.listConcludedForUser(ctx.from.id);
    if (deals.length === 0) {
      await ctx.reply(it.noConcludedDeals, { reply_markup: mainMenuKeyboard() });
      return;
    }

    const lines = deals.slice(0, 20).map((d) => {
      const amt = d.amount ? `${d.amount} ${d.asset}` : d.asset;
      return `• *#${d.id}* — ${amt} — ${statusLabel(d.status)}`;
    });
    await ctx.reply(`*I tuoi deal conclusi*\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  };

  bot.command("miei", listDeals);
  bot.hears("📋 I miei deal", listDeals);
}
