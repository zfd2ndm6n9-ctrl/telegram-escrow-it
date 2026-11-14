import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import { cancelKeyboard, confirmDealKeyboard, mainMenuKeyboard } from "../keyboards/menus.js";
import { parseAmount, parseCounterpart } from "../services/deal-logic.js";

export function registerCreateDealHandlers(bot: Bot<BotContext>): void {
  const beginCreate = async (ctx: BotContext) => {
    ctx.session.creating = { step: "amount" };
    await ctx.reply(it.askAmount, {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard(),
    });
  };

  bot.command("crea", beginCreate);
  bot.hears("➕ Crea deal", beginCreate);

  bot.hears("❌ Annulla", async (ctx) => {
    if (!ctx.session.creating) {
      await ctx.reply(it.cancelled, { reply_markup: mainMenuKeyboard() });
      return;
    }
    ctx.session.creating = undefined;
    await ctx.reply(it.cancelled, { reply_markup: mainMenuKeyboard() });
  });

  bot.on("message:text", async (ctx, next) => {
    const creating = ctx.session.creating;
    if (!creating || !ctx.from) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    if (creating.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply(it.invalidAmount, { parse_mode: "Markdown" });
        return;
      }
      ctx.session.creating = { step: "counterpart", amount };
      await ctx.reply(it.askCounterpart, {
        parse_mode: "Markdown",
        reply_markup: cancelKeyboard(),
      });
      return;
    }

    if (creating.step === "counterpart") {
      const counterpart = parseCounterpart(text);
      if (!counterpart) {
        await ctx.reply(it.invalidCounterpart);
        return;
      }

      if (counterpart.counterpartId === ctx.from.id) {
        await ctx.reply("Non puoi indicare te stesso come controparte.");
        return;
      }

      const amount = creating.amount;
      if (!amount) {
        ctx.session.creating = { step: "amount" };
        await ctx.reply(it.askAmount, { parse_mode: "Markdown" });
        return;
      }

      const deal = ctx.store.create({
        creatorId: ctx.from.id,
        creatorUsername: ctx.from.username,
        counterpartId: counterpart.counterpartId,
        counterpartUsername: counterpart.counterpartUsername,
        amount,
        asset: config.defaultAsset,
        escrowAddress: config.mockEscrowAddress,
      });

      ctx.session.creating = undefined;

      await ctx.reply(it.dealCreated(deal, config.botUsername ?? ctx.botUsername), {
        parse_mode: "Markdown",
        reply_markup: mainMenuKeyboard(),
      });

      // Notifica diretta se conosciamo l'id numerico e l'utente ha già aperto il bot
      if (deal.counterpartId != null) {
        try {
          await ctx.api.sendMessage(deal.counterpartId, it.confirmPrompt(deal), {
            parse_mode: "Markdown",
            reply_markup: confirmDealKeyboard(deal.id),
          });
        } catch {
          await ctx.reply(
            "Non sono riuscito a contattare la controparte direttamente (deve aver già avviato il bot). Condividi il link di invito.",
          );
        }
      }
    }
  });
}
