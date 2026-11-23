import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it, statusLabel } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { cancelMidCreaBeforeGroupBind } from "../services/dm-hygiene.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import { dismissInviteStep } from "../services/invite-step.js";

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

    // Mid /crea prima di «aggiungi bot»: cancella sequenza e mostra /miei.
    await cancelMidCreaBeforeGroupBind(ctx);

    // Echo utente: cancella precedente + corrente (il bot list si edita in place).
    const prevUserId = ctx.session.mieiUserCommandMessageId;
    const prevBotId = ctx.session.mieiListMessageId;
    const thisUserId = ctx.message?.message_id;
    ctx.session.mieiUserCommandMessageId = undefined;

    if (prevUserId != null && prevUserId !== thisUserId) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, prevUserId);
    }
    if (thisUserId != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, thisUserId);
      // Se delete fallisce, il prossimo /miei ritenta via session.
      ctx.session.mieiUserCommandMessageId = thisUserId;
    }

    // Solo conclusi (released / refunded): i deal aperti vivono nel gruppo.
    const deals = ctx.store.listConcludedForUser(ctx.from.id);
    const { text, parseMarkdown } = concludedListBody(deals);
    const parse_mode = parseMarkdown ? ("Markdown" as const) : undefined;

    // Edit-in-place: un comando → un messaggio (no stack).
    if (prevBotId != null) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, prevBotId, text, {
          parse_mode,
        });
        ctx.session.mieiListMessageId = prevBotId;
        return;
      } catch {
        // Messaggio assente / non editabile → elimina e ripubblica.
        await deleteMessageSafe(ctx.api, ctx.chat.id, prevBotId);
        ctx.session.mieiListMessageId = undefined;
      }
    }

    const msg = await ctx.reply(text, {
      parse_mode,
      reply_markup: mainMenuKeyboard(),
    });
    ctx.session.mieiListMessageId = msg.message_id;
  };

  bot.command("miei", listDeals);
  bot.hears("📋 I miei deal", listDeals);
}
