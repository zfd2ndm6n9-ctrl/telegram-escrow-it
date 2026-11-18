import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it, statusLabel } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import { dismissInviteStep } from "./start.js";

function concludedListBody(
  deals: ReturnType<BotContext["store"]["listConcludedForUser"]>,
): { text: string; parseMarkdown: boolean } {
  if (deals.length === 0) {
    return { text: it.noConcludedDeals, parseMarkdown: false };
  }
  const lines = deals.slice(0, 20).map((d) => {
    const amt = d.amount ? `${d.amount} ${d.asset}` : d.asset;
    return `• *#${d.id}* — ${amt} — ${statusLabel(d.status)}`;
  });
  return {
    text: `*I tuoi deal conclusi*\n\n${lines.join("\n")}`,
    parseMarkdown: true,
  };
}

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
    const { text, parseMarkdown } = concludedListBody(deals);
    const prevId = ctx.session.mieiListMessageId;

    if (prevId != null) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, prevId, text, {
          parse_mode: parseMarkdown ? "Markdown" : undefined,
        });
        return;
      } catch {
        // Messaggio assente / non editabile → elimina e ripubblica.
        await deleteMessageSafe(ctx.api, ctx.chat.id, prevId);
        ctx.session.mieiListMessageId = undefined;
      }
    }

    const msg = await ctx.reply(text, {
      parse_mode: parseMarkdown ? "Markdown" : undefined,
      reply_markup: mainMenuKeyboard(),
    });
    ctx.session.mieiListMessageId = msg.message_id;
  };

  bot.command("miei", listDeals);
  bot.hears("📋 I miei deal", listDeals);
}
