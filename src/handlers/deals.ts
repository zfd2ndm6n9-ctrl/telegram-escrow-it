import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it, statusLabel } from "../messages/it.js";
import { dealActionsKeyboard, mainMenuKeyboard } from "../keyboards/menus.js";
import { isParty } from "../services/deal-logic.js";

export function registerDealViewHandlers(bot: Bot<BotContext>): void {
  const listDeals = async (ctx: BotContext) => {
    if (!ctx.from) return;
    const deals = ctx.store.listForUser(ctx.from.id);
    if (deals.length === 0) {
      await ctx.reply(it.noDeals, { reply_markup: mainMenuKeyboard() });
      return;
    }

    const lines = deals.slice(0, 20).map((d) => {
      return `• *#${d.id}* — ${d.amount} ${d.asset} — ${statusLabel(d.status)}`;
    });
    await ctx.reply(`*I tuoi deal*\n\n${lines.join("\n")}\n\nDettaglio: /deal \\<id\\>`, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  };

  bot.command("miei", listDeals);
  bot.hears("📋 I miei deal", listDeals);

  bot.command("deal", async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) {
      await ctx.reply(it.needDealId.replace("/dispute", "/deal"));
      return;
    }
    const deal = ctx.store.get(id);
    if (!deal) {
      await ctx.reply(it.dealNotFound);
      return;
    }
    if (!ctx.from || !isParty(deal, ctx.from.id)) {
      await ctx.reply(it.notParty);
      return;
    }
    await ctx.reply(it.dealSummary(deal), {
      parse_mode: "Markdown",
      reply_markup: dealActionsKeyboard(deal.id, deal.status),
    });
  });
}
