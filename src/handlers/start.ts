import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import { confirmDealKeyboard, mainMenuKeyboard } from "../keyboards/menus.js";
import { bindCounterpartIfNeeded, isParty } from "../services/deal-logic.js";

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim();

    if (payload?.startsWith("deal_")) {
      const dealId = payload.slice("deal_".length);
      const deal = ctx.store.get(dealId);
      if (!deal) {
        await ctx.reply(it.dealNotFound);
        return;
      }

      const user = ctx.from;
      if (!user) return;

      const bound = bindCounterpartIfNeeded(deal, user.id, user.username);
      if (bound) {
        ctx.store.update(deal.id, {
          counterpartId: bound.counterpartId,
          counterpartUsername: bound.counterpartUsername,
        });
      }

      const fresh = ctx.store.get(deal.id)!;
      if (fresh.status === "pending_confirm" && fresh.counterpartId === user.id) {
        await ctx.reply(it.confirmPrompt(fresh), {
          parse_mode: "Markdown",
          reply_markup: confirmDealKeyboard(fresh.id),
        });
        return;
      }

      if (!isParty(fresh, user.id)) {
        await ctx.reply(it.notParty);
        return;
      }

      await ctx.reply(it.dealSummary(fresh), { parse_mode: "Markdown" });
      return;
    }

    await ctx.reply(it.welcome, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.command("aiuto", async (ctx) => {
    await ctx.reply(it.help, { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() });
  });

  bot.hears("❓ Aiuto", async (ctx) => {
    await ctx.reply(it.help, { parse_mode: "Markdown" });
  });
}
