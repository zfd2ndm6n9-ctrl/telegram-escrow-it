import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import {
  cancelKeyboard,
  createGroupKeyboard,
  mainMenuKeyboard,
  roleKeyboard,
} from "../keyboards/menus.js";
import { parseAmount, startGroupPayload } from "../services/deal-logic.js";
import type { PartyRole } from "../types.js";

export function registerCreateDealHandlers(bot: Bot<BotContext>): void {
  const beginCreate = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.onlyPrivate, { parse_mode: "Markdown" });
      return;
    }
    ctx.session.creating = { step: "role" };
    await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
  };

  bot.command("crea", beginCreate);
  bot.command("create", beginCreate);
  bot.hears("➕ Crea escrow", beginCreate);

  bot.hears("❌ Annulla", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.creating = undefined;
    await ctx.reply(it.cancelled, { reply_markup: mainMenuKeyboard() });
  });

  bot.hears("🛒 Sono il buyer", async (ctx) => {
    await pickRole(ctx, "buyer");
  });

  bot.hears("🏪 Sono il seller", async (ctx) => {
    await pickRole(ctx, "seller");
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

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

    // Ruolo già gestito dagli hears
    if (creating.step === "role") {
      await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
      return;
    }

    if (creating.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply(it.invalidAmount, {
          parse_mode: "Markdown",
          reply_markup: cancelKeyboard(),
        });
        return;
      }

      const role = creating.role;
      if (!role) {
        ctx.session.creating = { step: "role" };
        await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
        return;
      }

      const deal = ctx.store.create({
        creatorId: ctx.from.id,
        creatorUsername: ctx.from.username,
        creatorRole: role,
        amount,
        asset: config.defaultAsset,
        escrowAddress: config.mockEscrowAddress,
      });

      ctx.session.creating = undefined;

      const username = config.botUsername ?? ctx.botUsername;
      const payload = startGroupPayload(deal.id);
      const startGroupUrl = username
        ? `https://t.me/${username}?startgroup=${payload}`
        : `startgroup=${payload}`;

      await ctx.reply(it.dealReadyToCreateGroup(deal, startGroupUrl), {
        parse_mode: "Markdown",
        reply_markup: username
          ? createGroupKeyboard(startGroupUrl)
          : mainMenuKeyboard(),
      });

      if (username) {
        await ctx.reply("Menu principale:", { reply_markup: mainMenuKeyboard() });
      }
    }
  });
}

async function pickRole(ctx: BotContext, role: PartyRole): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  if (!ctx.session.creating || ctx.session.creating.step !== "role") {
    ctx.session.creating = { step: "role" };
  }
  ctx.session.creating = { step: "amount", role };
  await ctx.reply(it.askAmount, {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}
