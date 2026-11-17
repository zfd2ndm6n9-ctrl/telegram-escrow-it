import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { isAdminUser } from "../services/deal-logic.js";
import { it } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    // /start in gruppo arriva spesso da startgroup=payload
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      return;
    }

    if (!ctx.from) return;

    try {
      const { isNew } = ctx.members.upsertFromStart(
        ctx.from.id,
        ctx.from.username,
      );
      const text = isNew ? it.welcome : it.welcomeBack;
      await ctx.reply(text, {
        parse_mode: "Markdown",
        reply_markup: mainMenuKeyboard(),
      });
      console.log(
        `/start ok chat=${ctx.chat?.id} from=${ctx.from.id} new=${isNew} iscritti=${ctx.members.size}`,
      );
    } catch (err) {
      console.error(
        `/start fail chat=${ctx.chat?.id} from=${ctx.from.id}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  });

  /** Admin: conteggio iscritti (+ ultimi recenti). */
  bot.command("iscritti", async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    const total = ctx.members.size;
    const recent = ctx.members.listRecent(8);
    const lines = recent.map((m) => {
      const who = m.username ? `@${m.username}` : String(m.userId);
      const day = m.lastSeen.slice(0, 10);
      return `• ${who} · ${day}`;
    });
    const body =
      lines.length > 0
        ? `${it.iscrittiCount(total)}\n\n${lines.join("\n")}`
        : it.iscrittiCount(total);
    await ctx.reply(body, { parse_mode: "Markdown" });
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
