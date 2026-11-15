import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  assignJoiningParty,
  bothPartiesPresent,
  isAllowedHuman,
  parseStartGroupPayload,
} from "../services/deal-logic.js";
import {
  bindGroupToDeal,
  checkRequiredBotAdminPerms,
  kickUnauthorized,
  postDealActivated,
} from "../services/group-setup.js";
import { counterpartConfirmKeyboard } from "../keyboards/menus.js";

async function onHumanJoined(
  ctx: BotContext,
  chatId: number,
  userId: number,
  username: string | undefined,
): Promise<void> {
  const deal = ctx.store.findByGroupChatId(chatId);
  if (!deal) return;

  // Deal non ancora attivato: non auto-assegnare via join; kick solo se già chiuso a 2 party
  if (!bothPartiesPresent(deal)) {
    if (isAllowedHuman(deal, userId) || userId === deal.creatorId) {
      const patch = assignJoiningParty(deal, userId, username);
      if (patch) ctx.store.update(deal.id, patch);
    }
    return;
  }

  if (isAllowedHuman(deal, userId)) {
    const patch = assignJoiningParty(deal, userId, username);
    if (patch) ctx.store.update(deal.id, patch);
    return;
  }

  await kickUnauthorized(ctx.api, chatId, userId);
}

export function registerGroupLifecycleHandlers(bot: Bot<BotContext>): void {
  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const update = ctx.myChatMember;
    const status = update.new_chat_member.status;
    const joined =
      status === "member" || status === "administrator" || status === "restricted";
    if (!joined) return;

    // Non avviare il deal qui: solo hint. Setup solo con /avvia dopo admin + parti.
    const pending = ctx.store.findAwaitingGroupByCreator(update.from.id);
    if (pending && pending.groupChatId == null) {
      ctx.store.update(pending.id, { groupChatId: chat.id, status: "awaiting_bot_admin" });
    }

    await ctx.api.sendMessage(chat.id, it.botAddedHint);
    console.log(`Bot aggiunto a chat ${chat.id}; in attesa di /avvia`);
  });

  /**
   * /avvia — chi ha creato il deal in DM collega il gruppo e chiede conferma controparte.
   * Alias: /setup
   */
  const avvia = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;

    const existing = ctx.store.findByGroupChatId(ctx.chat.id);
    if (existing && bothPartiesPresent(existing) && existing.status !== "awaiting_counterpart" && existing.status !== "awaiting_bot_admin" && existing.status !== "awaiting_group") {
      await ctx.reply(it.alreadyActivated);
      return;
    }

    let deal =
      existing && existing.creatorId === ctx.from.id
        ? existing
        : ctx.store.findAwaitingGroupByCreator(ctx.from.id);

    if (!deal) {
      // Altro membro con deal già bound
      if (existing) {
        if (existing.creatorId !== ctx.from.id) {
          await ctx.reply(it.notCreator);
          return;
        }
        deal = existing;
      } else {
        await ctx.reply(it.noDealInGroup);
        return;
      }
    }

    if (deal.creatorId !== ctx.from.id) {
      await ctx.reply(it.notCreator);
      return;
    }

    if (deal.groupChatId != null && deal.groupChatId !== ctx.chat.id) {
      await ctx.reply(it.alreadyBound);
      return;
    }

    const { deal: bound, perms } = await bindGroupToDeal(
      ctx.api,
      ctx.store,
      deal,
      ctx.chat.id,
    );

    if (!perms.ok) {
      await ctx.reply(it.missingBotPerms(perms.missing), { parse_mode: "Markdown" });
      return;
    }

    if (bothPartiesPresent(bound)) {
      const active =
        bound.status === "awaiting_counterpart" || bound.status === "awaiting_bot_admin"
          ? ctx.store.setStatus(bound.id, "awaiting_deposit")!
          : bound;
      await postDealActivated(ctx.api, active);
      return;
    }

    const waiting =
      ctx.store.setStatus(bound.id, "awaiting_counterpart") ?? bound;
    await ctx.reply(it.askCounterpartConfirm(waiting), {
      parse_mode: "Markdown",
      reply_markup: counterpartConfirmKeyboard(waiting.id),
    });
  };

  bot.command("avvia", avvia);
  bot.command("setup", avvia);

  // Controparte conferma nel gruppo
  bot.callbackQuery(/^cp:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    const deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.answerCallbackQuery({ text: "Solo in gruppo" });
      return;
    }
    if (deal.groupChatId != null && deal.groupChatId !== ctx.chat.id) {
      await ctx.answerCallbackQuery({ text: "Gruppo sbagliato" });
      return;
    }
    if (ctx.from.id === deal.creatorId) {
      await ctx.answerCallbackQuery({ text: "Sei il creatore" });
      await ctx.reply(it.counterpartIsCreator);
      return;
    }
    if (bothPartiesPresent(deal)) {
      await ctx.answerCallbackQuery({ text: "Già completo" });
      await ctx.reply(it.counterpartTaken);
      return;
    }

    const perms = await checkRequiredBotAdminPerms(ctx.api, ctx.chat.id);
    if (!perms.ok) {
      await ctx.answerCallbackQuery({ text: "Permessi bot mancanti" });
      await ctx.reply(it.missingBotPerms(perms.missing), { parse_mode: "Markdown" });
      return;
    }

    const patch = assignJoiningParty(deal, ctx.from.id, ctx.from.username);
    if (!patch || (patch.buyerId !== ctx.from.id && patch.sellerId !== ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non assegnabile" });
      return;
    }

    let updated = ctx.store.update(deal.id, {
      ...patch,
      groupChatId: ctx.chat.id,
    })!;

    if (bothPartiesPresent(updated)) {
      updated = ctx.store.setStatus(updated.id, "awaiting_deposit")!;
      await ctx.answerCallbackQuery({ text: "Confermato" });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await postDealActivated(ctx.api, updated);
      return;
    }

    await ctx.answerCallbackQuery({ text: "Ok" });
  });

  // startgroup payload: memorizza chat, non avviare deal / non invitare
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
    if (!startMatch?.[1] || !ctx.from) {
      await next();
      return;
    }

    const dealId = parseStartGroupPayload(startMatch[1]);
    if (!dealId) {
      await next();
      return;
    }

    const deal = ctx.store.get(dealId);
    if (!deal) {
      await next();
      return;
    }

    if (deal.groupChatId != null && deal.groupChatId !== ctx.chat.id) {
      await ctx.reply(it.alreadyBound);
      return;
    }

    if (deal.creatorId === ctx.from.id && deal.groupChatId == null) {
      ctx.store.update(deal.id, {
        groupChatId: ctx.chat.id,
        status: "awaiting_bot_admin",
      });
    }

    await ctx.reply(it.botAddedHint);
  });

  bot.on("chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const member = ctx.chatMember.new_chat_member;
    const user = member.user;
    if (user.is_bot) return;

    const becameMember =
      member.status === "member" ||
      member.status === "administrator" ||
      member.status === "restricted";
    if (!becameMember) return;

    await onHumanJoined(ctx, chat.id, user.id, user.username);
  });

  bot.on("message:new_chat_members", async (ctx) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") return;
    if (!ctx.store.findByGroupChatId(ctx.chat.id)) return;

    for (const user of ctx.message.new_chat_members) {
      if (user.is_bot) continue;
      await onHumanJoined(ctx, ctx.chat.id, user.id, user.username);
    }
  });
}
