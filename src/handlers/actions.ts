import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import { dealActionsKeyboard } from "../keyboards/menus.js";
import {
  addUniqueVote,
  bindCounterpartIfNeeded,
  isParty,
} from "../services/deal-logic.js";
import type { Deal } from "../types.js";

async function notifyOtherParty(
  ctx: BotContext,
  deal: Deal,
  text: string,
): Promise<void> {
  if (!ctx.from) return;
  const otherId =
    deal.creatorId === ctx.from.id ? deal.counterpartId : deal.creatorId;
  if (otherId == null) return;
  try {
    await ctx.api.sendMessage(otherId, text, {
      parse_mode: "Markdown",
      reply_markup: dealActionsKeyboard(deal.id, deal.status),
    });
  } catch {
    // Controparte non raggiungibile: ok in MVP
  }
}

export function registerActionHandlers(bot: Bot<BotContext>): void {
  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    const deal = ctx.store.get(dealId);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }

    const bound = bindCounterpartIfNeeded(deal, ctx.from.id, ctx.from.username);
    if (bound) {
      ctx.store.update(deal.id, bound);
    }
    const fresh = ctx.store.get(deal.id)!;

    if (fresh.status !== "pending_confirm") {
      await ctx.answerCallbackQuery({ text: "Già gestito" });
      await ctx.reply(it.alreadyConfirmed);
      return;
    }

    if (fresh.counterpartId !== ctx.from.id) {
      await ctx.answerCallbackQuery({ text: "Non autorizzato" });
      await ctx.reply(it.notCounterpart);
      return;
    }

    const updated = ctx.store.setStatus(deal.id, "awaiting_deposit")!;
    await ctx.answerCallbackQuery({ text: "Deal confermato" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    await ctx.reply(it.confirmed(updated), {
      parse_mode: "Markdown",
      reply_markup: dealActionsKeyboard(updated.id, updated.status),
    });

    try {
      await ctx.api.sendMessage(updated.creatorId, it.confirmed(updated), {
        parse_mode: "Markdown",
        reply_markup: dealActionsKeyboard(updated.id, updated.status),
      });
    } catch {
      // ignore
    }
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    const deal = ctx.store.get(dealId);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (deal.status !== "pending_confirm") {
      await ctx.answerCallbackQuery({ text: "Già gestito" });
      return;
    }

    const bound = bindCounterpartIfNeeded(deal, ctx.from.id, ctx.from.username);
    if (bound) ctx.store.update(deal.id, bound);
    const fresh = ctx.store.get(deal.id)!;

    const isCounterpart =
      fresh.counterpartId === ctx.from.id ||
      (fresh.counterpartUsername != null &&
        ctx.from.username?.toLowerCase() === fresh.counterpartUsername.toLowerCase());

    if (!isCounterpart) {
      await ctx.answerCallbackQuery({ text: "Non autorizzato" });
      await ctx.reply(it.notCounterpart);
      return;
    }

    if (fresh.counterpartId == null) {
      ctx.store.update(deal.id, { counterpartId: ctx.from.id });
    }

    ctx.store.setStatus(deal.id, "cancelled");
    await ctx.answerCallbackQuery({ text: "Deal rifiutato" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    await ctx.reply(`Deal #${deal.id} rifiutato e annullato.`);
    try {
      await ctx.api.sendMessage(
        deal.creatorId,
        `La controparte ha rifiutato il deal *#${deal.id}*.`,
        { parse_mode: "Markdown" },
      );
    } catch {
      // ignore
    }
  });

  bot.callbackQuery(/^funded:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    const deal = ctx.store.get(dealId);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non autorizzato" });
      return;
    }
    if (deal.status !== "awaiting_deposit") {
      await ctx.answerCallbackQuery({ text: "Stato non valido" });
      await ctx.reply(it.wrongStatus(deal.status));
      return;
    }

    const updated = ctx.store.setStatus(deal.id, "funded")!;
    await ctx.answerCallbackQuery({ text: "Segnato come depositato" });
    await ctx.reply(it.markFundedDone(updated), {
      parse_mode: "Markdown",
      reply_markup: dealActionsKeyboard(updated.id, updated.status),
    });
    await notifyOtherParty(
      ctx,
      updated,
      `L'altra parte ha segnato il deposito sul deal *#${updated.id}* (stub MVP).`,
    );
  });

  bot.callbackQuery(/^release:(.+)$/, async (ctx) => {
    await handleDualConfirm(ctx, "release");
  });

  bot.callbackQuery(/^refund:(.+)$/, async (ctx) => {
    await handleDualConfirm(ctx, "refund");
  });

  bot.callbackQuery(/^detail:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    const deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non disponibile" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(it.dealSummary(deal), {
      parse_mode: "Markdown",
      reply_markup: dealActionsKeyboard(deal.id, deal.status),
    });
  });

  bot.callbackQuery(/^dispute:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    await openDispute(ctx, dealId);
  });
}

async function handleDualConfirm(
  ctx: BotContext,
  kind: "release" | "refund",
): Promise<void> {
  const dealId = ctx.match![1];
  const deal = ctx.store.get(dealId);
  if (!deal || !ctx.from) {
    await ctx.answerCallbackQuery({ text: "Deal non trovato" });
    return;
  }
  if (!isParty(deal, ctx.from.id) || deal.counterpartId == null) {
    await ctx.answerCallbackQuery({ text: "Non autorizzato" });
    await ctx.reply(it.notParty);
    return;
  }

  const allowedStatuses =
    kind === "release"
      ? ["funded", "release_pending"]
      : ["funded", "refund_pending"];

  if (!allowedStatuses.includes(deal.status)) {
    // Se l'altra azione è in corso, blocca
    if (
      (kind === "release" && deal.status === "refund_pending") ||
      (kind === "refund" && deal.status === "release_pending")
    ) {
      await ctx.answerCallbackQuery({ text: "Altra azione in corso" });
      await ctx.reply(it.wrongStatus(deal.status));
      return;
    }
    await ctx.answerCallbackQuery({ text: "Stato non valido" });
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }

  const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
  const votes = addUniqueVote(deal[voteKey], ctx.from.id);
  const pendingStatus = kind === "release" ? "release_pending" : "refund_pending";
  const doneStatus = kind === "release" ? "released" : "refunded";

  let nextStatus = deal.status === "funded" ? pendingStatus : deal.status;
  const done = votes.length >= 2;
  if (done) nextStatus = doneStatus;

  const updated = ctx.store.update(deal.id, {
    [voteKey]: votes,
    status: nextStatus,
  })!;

  const remaining = Math.max(0, 2 - votes.length);
  await ctx.answerCallbackQuery({
    text: done ? (kind === "release" ? "Rilasciato" : "Rimborsato") : "Voto registrato",
  });

  const msg =
    kind === "release" ? it.releaseVote(updated, remaining) : it.refundVote(updated, remaining);

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    reply_markup: done ? undefined : dealActionsKeyboard(updated.id, updated.status),
  });

  await notifyOtherParty(ctx, updated, msg);
}

export async function openDispute(ctx: BotContext, dealId: string): Promise<void> {
  const deal = ctx.store.get(dealId);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Deal non trovato" });
    else await ctx.reply(it.dealNotFound);
    return;
  }
  if (!isParty(deal, ctx.from.id)) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Non autorizzato" });
    else await ctx.reply(it.notParty);
    return;
  }

  const updated = ctx.store.setStatus(deal.id, "disputed")!;
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Disputa aperta" });

  await ctx.reply(it.disputeOpened(updated), { parse_mode: "Markdown" });

  if (config.adminTelegramId) {
    try {
      await ctx.api.sendMessage(
        config.adminTelegramId,
        it.disputeAdminNotify(updated, ctx.from.id, ctx.from.username),
      );
    } catch {
      await ctx.reply(
        "Non sono riuscito a notificare l'admin. Controlla ADMIN_TELEGRAM_ID.",
      );
    }
  } else {
    await ctx.reply(it.adminMissing);
  }
}
