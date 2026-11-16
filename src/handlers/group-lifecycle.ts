import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  assignJoiningParty,
  bothPartiesPresent,
  isAllowedHuman,
  isParty,
  isPreDepositSetup,
  parseStartGroupPayload,
  tosAccepted,
} from "../services/deal-logic.js";
import { hardenGroupPermissions } from "../services/group-creator.js";
import {
  checkRequiredBotAdminPerms,
  kickUnauthorized,
  postAskSellerWallet,
  postStabilizeTos,
  postTosDraft,
  startDealInGroup,
} from "../services/group-setup.js";
import { kickUnauthorizedBot } from "./group-hygiene.js";

const MIN_TOS_LENGTH = 20;

function displayNameOf(user: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

async function onHumanJoined(
  ctx: BotContext,
  chatId: number,
  userId: number,
  username: string | undefined,
  displayName?: string,
): Promise<void> {
  const deal = ctx.store.findByGroupChatId(chatId);
  if (!deal) return;

  // Deal non ancora attivato: non auto-assegnare via join; kick solo se già chiuso a 2 party
  if (!bothPartiesPresent(deal)) {
    if (isAllowedHuman(deal, userId) || userId === deal.creatorId) {
      const patch = assignJoiningParty(deal, userId, username, displayName);
      if (patch) ctx.store.update(deal.id, patch);
    }
    return;
  }

  if (isAllowedHuman(deal, userId)) {
    const patch = assignJoiningParty(deal, userId, username, displayName);
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

    const already = ctx.store.findByGroupChatId(chat.id);
    if (already) {
      if (status === "administrator") {
        await hardenGroupPermissions(ctx.api, chat.id);
      }
      console.log(`Bot in chat ${chat.id} (deal #${already.id} già collegato)`);
      return;
    }

    // Path felice: bot aggiunto a gruppo creato dall'utente.
    const pending = ctx.store.findAwaitingGroupByCreator(update.from.id);
    if (pending && pending.groupChatId == null) {
      ctx.store.update(pending.id, {
        groupChatId: chat.id,
        status: "awaiting_bot_admin",
      });
    }

    await ctx.api.sendMessage(chat.id, it.botAddedHint);
    console.log(`Bot aggiunto a chat ${chat.id}; in attesa di /avvia`);
  });

  /**
   * /avvia — collega il gruppo al deal e avvia conferma controparte.
   * Alias: /setup. Path felice dopo gruppo manuale + bot admin.
   */
  const avvia = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;

    const existing = ctx.store.findByGroupChatId(ctx.chat.id);
    // Già collegato e oltre il bind: niente seconda card completa.
    if (
      existing &&
      existing.status !== "awaiting_bot_admin" &&
      existing.status !== "awaiting_group"
    ) {
      await ctx.reply(it.alreadyLinkedShort(existing), {
        parse_mode: "Markdown",
      });
      return;
    }

    let deal =
      existing && existing.creatorId === ctx.from.id
        ? existing
        : ctx.store.findAwaitingGroupByCreator(ctx.from.id);

    if (!deal) {
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

    await hardenGroupPermissions(ctx.api, ctx.chat.id);

    const { deal: started, perms } = await startDealInGroup(
      ctx.api,
      ctx.store,
      deal,
      ctx.chat.id,
    );

    if (!perms.ok) {
      await ctx.reply(it.missingBotPerms(perms.missing), {
        parse_mode: "Markdown",
      });
      return;
    }

    if (
      bothPartiesPresent(started) &&
      started.status !== "awaiting_counterpart" &&
      !isPreDepositSetup(started.status) &&
      tosAccepted(started)
    ) {
      await ctx.reply(it.alreadyActivated);
    }
  };

  bot.command("avvia", avvia);
  bot.command("setup", avvia);

  // Controparte conferma nel gruppo → Stabiliamo i ToS
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
    if (bothPartiesPresent(deal) && deal.status !== "awaiting_counterpart") {
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

    const alreadyParty = isParty(deal, ctx.from.id);
    const patch = assignJoiningParty(
      deal,
      ctx.from.id,
      ctx.from.username,
      displayNameOf(ctx.from),
    );
    if (
      !alreadyParty &&
      (!patch || (patch.buyerId !== ctx.from.id && patch.sellerId !== ctx.from.id))
    ) {
      await ctx.answerCallbackQuery({ text: "Non assegnabile" });
      return;
    }

    let updated = ctx.store.update(deal.id, {
      ...(patch ?? {}),
      groupChatId: ctx.chat.id,
    })!;

    if (bothPartiesPresent(updated)) {
      updated = ctx.store.setStatus(updated.id, "awaiting_tos")!;
      await ctx.answerCallbackQuery({ text: "Confermato" });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
      await postStabilizeTos(ctx.api, ctx.store, updated);
      return;
    }

    await ctx.answerCallbackQuery({ text: "Ok" });
  });

  // Controparte accetta i ToS → wallet seller
  bot.callbackQuery(/^tosok:(.+)$/, async (ctx) => {
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
    if (!deal.tosText || deal.status !== "awaiting_tos_confirm") {
      await ctx.answerCallbackQuery({ text: "Nessun ToS da accettare" });
      return;
    }
    if (tosAccepted(deal)) {
      await ctx.answerCallbackQuery({ text: "Già accettati" });
      await ctx.reply(it.tosAlreadyAccepted);
      return;
    }
    if (ctx.from.id === deal.creatorId) {
      await ctx.answerCallbackQuery({ text: "Solo controparte" });
      await ctx.reply(it.tosCreatorCannotAccept);
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non sei parte" });
      await ctx.reply(it.notParty);
      return;
    }

    const updated = ctx.store.update(deal.id, {
      tosAcceptedAt: new Date().toISOString(),
      status: "awaiting_seller_wallet",
    })!;

    await ctx.answerCallbackQuery({ text: "ToS accettati" });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);
    await postAskSellerWallet(ctx.api, ctx.store, updated);
  });

  // Creatore scrive i ToS (o li aggiorna prima della conferma)
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
    if (startMatch?.[1] && ctx.from) {
      const dealId = parseStartGroupPayload(startMatch[1]);
      if (dealId) {
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
        return;
      }
    }

    if (text.startsWith("/")) {
      await next();
      return;
    }

    const deal = ctx.store.findByGroupChatId(ctx.chat.id);
    if (!deal || !ctx.from) {
      await next();
      return;
    }

    if (
      deal.status !== "awaiting_tos" &&
      deal.status !== "awaiting_tos_confirm"
    ) {
      await next();
      return;
    }

    if (ctx.from.id !== deal.creatorId) {
      if (deal.status === "awaiting_tos") {
        await ctx.reply(it.onlyCreatorWritesTos);
        return;
      }
      await next();
      return;
    }

    if (text.length < MIN_TOS_LENGTH) {
      await ctx.reply(it.tosTooShort);
      return;
    }

    const updated = ctx.store.update(deal.id, {
      tosText: text,
      tosAcceptedAt: undefined,
      status: "awaiting_tos_confirm",
    })!;

    await postTosDraft(ctx.api, ctx.store, updated);
  });

  bot.on("chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const member = ctx.chatMember.new_chat_member;
    const user = member.user;

    const becameMember =
      member.status === "member" ||
      member.status === "administrator" ||
      member.status === "restricted";
    if (!becameMember) return;

    if (user.is_bot) {
      await kickUnauthorizedBot(ctx, chat.id, user);
      return;
    }

    await onHumanJoined(
      ctx,
      chat.id,
      user.id,
      user.username,
      displayNameOf(user),
    );
  });

  bot.on("message:new_chat_members", async (ctx) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") return;
    if (!ctx.store.findByGroupChatId(ctx.chat.id)) return;

    for (const user of ctx.message.new_chat_members) {
      if (user.is_bot) {
        await kickUnauthorizedBot(ctx, ctx.chat.id, user);
        continue;
      }
      await onHumanJoined(
        ctx,
        ctx.chat.id,
        user.id,
        user.username,
        displayNameOf(user),
      );
    }
  });
}
