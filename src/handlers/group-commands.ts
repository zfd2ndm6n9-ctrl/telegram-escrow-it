import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";
import {
  addUniqueVote,
  isAdminUser,
  isParty,
} from "../services/deal-logic.js";
import { createAdminInviteLink } from "../services/group-setup.js";
import type { Deal } from "../types.js";

function requireGroupDeal(ctx: BotContext): Deal | null {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    return null;
  }
  return ctx.store.findByGroupChatId(ctx.chat.id) ?? null;
}

export function registerGroupCommandHandlers(bot: Bot<BotContext>): void {
  bot.command("indirizzo", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      if (ctx.chat?.type === "private") await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      else await ctx.reply(it.noDealInGroup);
      return;
    }
    await ctx.reply(it.depositAddress(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
  });

  bot.command("depositato", async (ctx) => {
    await markFunded(ctx);
  });

  bot.command("stato", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.reply(it.noDealInGroup);
      return;
    }
    await ctx.reply(formatStato(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
  });

  bot.command("pay_seller", async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  bot.command("refund_buyer", async (ctx) => {
    await handlePayOrRefund(ctx, "refund");
  });

  bot.command("dispute", async (ctx) => {
    await openDispute(ctx);
  });

  bot.callbackQuery("addr", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(it.depositAddress(deal), { parse_mode: "Markdown" });
  });

  bot.callbackQuery("funded", async (ctx) => {
    await ctx.answerCallbackQuery();
    await markFunded(ctx);
  });

  bot.callbackQuery("pay_seller", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePayOrRefund(ctx, "release");
  });

  bot.callbackQuery("refund_buyer", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePayOrRefund(ctx, "refund");
  });

  bot.callbackQuery("dispute", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openDispute(ctx);
  });

  bot.callbackQuery("stato", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(formatStato(deal), { parse_mode: "Markdown" });
  });
}

function formatStato(deal: Deal): string {
  return `*Deal #${deal.id}*
• Stato: \`${deal.status}\`
• Importo: *${deal.amount} ${deal.asset}*
• Buyer: ${deal.buyerId ?? "—"}
• Seller: ${deal.sellerId ?? "—"}
• Escrow: \`${deal.escrowAddress}\``;
}

async function markFunded(ctx: BotContext): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }
  if (deal.status !== "awaiting_deposit") {
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }
  const updated = ctx.store.setStatus(deal.id, "funded")!;
  await ctx.reply(it.markFundedDone(updated), {
    parse_mode: "Markdown",
    reply_markup: groupActionsKeyboard(updated.status),
  });
}

async function handlePayOrRefund(
  ctx: BotContext,
  kind: "release" | "refund",
): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }

  // Admin in disputa: forza esito
  if (deal.status === "disputed" && isAdminUser(ctx.from.id)) {
    const doneStatus = kind === "release" ? "released" : "refunded";
    const updated = ctx.store.setStatus(deal.id, doneStatus)!;
    await ctx.reply(
      kind === "release" ? it.adminForceRelease(updated) : it.adminForceRefund(updated),
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (!isParty(deal, ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  if (!deal.buyerId || !deal.sellerId) {
    await ctx.reply("Mancano ancora buyer o seller nel deal.");
    return;
  }

  const allowed =
    kind === "release"
      ? ["funded", "release_pending"]
      : ["funded", "refund_pending"];

  if (!allowed.includes(deal.status)) {
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }

  const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
  const votes = addUniqueVote(deal[voteKey], ctx.from.id);
  const pendingStatus = kind === "release" ? "release_pending" : "refund_pending";
  const doneStatus = kind === "release" ? "released" : "refunded";
  const done = votes.length >= 2;

  const updated = ctx.store.update(deal.id, {
    [voteKey]: votes,
    status: done ? doneStatus : pendingStatus,
  })!;

  const remaining = Math.max(0, 2 - votes.length);
  const msg =
    kind === "release"
      ? it.releaseVote(updated, remaining)
      : it.refundVote(updated, remaining);

  await ctx.reply(msg, {
    parse_mode: "Markdown",
    reply_markup: done ? undefined : groupActionsKeyboard(updated.status),
  });
}

export async function openDispute(ctx: BotContext): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  if (deal.groupChatId == null) {
    await ctx.reply(it.noDealInGroup);
    return;
  }

  let adminLink = deal.adminInviteLink;
  if (!adminLink) {
    adminLink = await createAdminInviteLink(ctx.api, deal.groupChatId, deal.id);
  }

  const updated = ctx.store.update(deal.id, {
    status: "disputed",
    adminInviteLink: adminLink,
  })!;

  await ctx.reply(it.disputeOpened(updated), { parse_mode: "Markdown" });

  if (!config.adminTelegramId) {
    await ctx.reply(it.adminMissing);
    return;
  }

  try {
    await ctx.api.sendMessage(
      config.adminTelegramId,
      it.disputeAdminNotify(
        updated,
        ctx.from.id,
        ctx.from.username,
        adminLink,
      ),
    );
  } catch (err) {
    console.error("Notifica admin fallita:", err);
    await ctx.reply("Disputa aperta ma non riesco a scrivere all'admin in privato (deve aver avviato il bot).");
  }
}
