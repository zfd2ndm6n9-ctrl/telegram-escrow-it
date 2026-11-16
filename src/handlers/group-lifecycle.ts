import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  amountConfirmed,
  assignJoiningParty,
  bothPartiesPresent,
  composeTosText,
  isAllowedHuman,
  isParty,
  isPreDepositSetup,
  parseAmount,
  parseStartGroupPayload,
  parseTermsProposal,
  termsReadyForConfirm,
  tosAccepted,
} from "../services/deal-logic.js";
import { hardenGroupPermissions } from "../services/group-creator.js";
import {
  autoBindCounterpart,
  checkRequiredBotAdminPerms,
  kickUnauthorized,
  postAskSellerWallet,
  postTosDraft,
  refreshGroupSetupCard,
  refreshGroupTitle,
  startDealInGroup,
  trackSeenGroupUser,
} from "../services/group-setup.js";
import {
  deleteMessageSafe,
  pinAcceptedTos,
  untrackPrompt,
} from "../services/prompt-cleanup.js";
import { kickUnauthorizedBot } from "./group-hygiene.js";

function displayNameOf(user: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function autoBindReply(reason: "too_many" | "none" | "need_message"): string {
  if (reason === "too_many") return it.autoBindTooMany;
  if (reason === "need_message") return it.autoBindNeedMessage;
  return it.autoBindNone;
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

  let current = trackSeenGroupUser(ctx.store, deal, userId);

  // Deal non ancora a 2 party: traccia; auto-bind solo via /avvia
  if (!bothPartiesPresent(current)) {
    if (isAllowedHuman(current, userId) || userId === current.creatorId) {
      const patch = assignJoiningParty(current, userId, username, displayName);
      if (patch) ctx.store.update(current.id, patch);
    }
    return;
  }

  if (isAllowedHuman(current, userId)) {
    const patch = assignJoiningParty(current, userId, username, displayName);
    if (patch) ctx.store.update(current.id, patch);
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
      trackSeenGroupUser(
        ctx.store,
        ctx.store.get(pending.id) ?? pending,
        update.from.id,
      );
    }

    await ctx.api.sendMessage(chat.id, it.botAddedHint);
    console.log(`Bot aggiunto a chat ${chat.id}; in attesa di /avvia`);
  });

  /**
   * /avvia — collega il gruppo, auto-assegna la controparte, apre la card termini.
   * Alias: /setup.
   */
  const avvia = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;

    const existing = ctx.store.findByGroupChatId(ctx.chat.id);
    // Già collegato oltre bind/auto-bind: niente seconda card completa.
    // awaiting_counterpart: permetti retry dopo invite / messaggio controparte.
    if (
      existing &&
      existing.status !== "awaiting_bot_admin" &&
      existing.status !== "awaiting_group" &&
      existing.status !== "awaiting_counterpart"
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

    const { deal: started, perms, autoBind } = await startDealInGroup(
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

    if (autoBind) {
      await ctx.reply(autoBindReply(autoBind), { parse_mode: "Markdown" });
      return;
    }

    if (
      bothPartiesPresent(started) &&
      started.status !== "awaiting_counterpart" &&
      !isPreDepositSetup(started.status) &&
      tosAccepted(started) &&
      amountConfirmed(started)
    ) {
      await ctx.reply(it.alreadyActivated);
    }
  };

  bot.command("avvia", avvia);
  bot.command("setup", avvia);

  // Legacy: vecchi pulsanti «Confermo» ruolo — reindirizza ad auto-bind
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

    const perms = await checkRequiredBotAdminPerms(ctx.api, ctx.chat.id);
    if (!perms.ok) {
      await ctx.answerCallbackQuery({ text: "Permessi bot mancanti" });
      await ctx.reply(it.missingBotPerms(perms.missing), {
        parse_mode: "Markdown",
      });
      return;
    }

    let current = trackSeenGroupUser(ctx.store, deal, ctx.from.id);
    if (bothPartiesPresent(current)) {
      await ctx.answerCallbackQuery({ text: "Già assegnati" });
      if (!tosAccepted(current) && current.status === "awaiting_counterpart") {
        current = ctx.store.setStatus(current.id, "awaiting_tos")!;
        await refreshGroupSetupCard(ctx.api, ctx.store, current);
      }
      return;
    }

    const bind = await autoBindCounterpart(
      ctx.api,
      ctx.store,
      current,
      ctx.chat.id,
    );
    if (!bind.ok) {
      await ctx.answerCallbackQuery({ text: "Auto-bind fallito" });
      await ctx.reply(autoBindReply(bind.reason), { parse_mode: "Markdown" });
      return;
    }

    current = ctx.store.setStatus(bind.deal.id, "awaiting_tos")!;
    await ctx.answerCallbackQuery({ text: "Ruoli ok" });
    await refreshGroupSetupCard(ctx.api, ctx.store, current);
  });

  // Controparte Accetta termini → lock + pin → wallet seller
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
    if (!termsReadyForConfirm(deal) || deal.status !== "awaiting_tos_confirm") {
      await ctx.answerCallbackQuery({ text: "Nessun termine da accettare" });
      return;
    }
    if (tosAccepted(deal)) {
      await ctx.answerCallbackQuery({ text: "Già accettati" });
      await ctx.reply(it.tosAlreadyAccepted);
      return;
    }
    if (ctx.from.id === deal.creatorId) {
      await ctx.answerCallbackQuery({ text: "Solo controparte" });
      await ctx.reply(it.tosOpenerCannotAccept(deal), {
        parse_mode: "Markdown",
      });
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non sei parte" });
      await ctx.reply(it.notParty);
      return;
    }

    const tosMsgId =
      ctx.callbackQuery.message?.message_id ?? deal.setupMessageId;
    const now = new Date().toISOString();
    let updated = ctx.store.update(deal.id, {
      tosAcceptedAt: now,
      amountConfirmedAt: now,
      status: "awaiting_seller_wallet",
      ...(tosMsgId != null
        ? {
            setupMessageId: deal.setupMessageId ?? tosMsgId,
            tosAcceptedMessageId: tosMsgId,
          }
        : {}),
    })!;

    if (tosMsgId != null) {
      updated = untrackPrompt(ctx.store, updated, tosMsgId);
      await pinAcceptedTos(ctx.api, ctx.chat.id, tosMsgId);
    }

    await ctx.answerCallbackQuery({ text: "Termini accettati" });
    await refreshGroupTitle(ctx.api, updated);
    updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
    await postAskSellerWallet(ctx.api, ctx.store, updated);
  });

  // Legacy dual-confirm importo (deal mid-flight pre-unificazione)
  bot.callbackQuery(/^amtok:(.+)$/, async (ctx) => {
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
    if (!deal.amount || deal.status !== "awaiting_amount_confirm") {
      await ctx.answerCallbackQuery({ text: "Flusso aggiornato: usa i termini" });
      return;
    }
    if (amountConfirmed(deal)) {
      await ctx.answerCallbackQuery({ text: "Già confermato" });
      await ctx.reply(it.amountAlreadyConfirmed);
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non sei parte" });
      await ctx.reply(it.amountOnlyParties);
      return;
    }

    // Un solo click basta nel percorso legacy residuo (allineato all'Accetto unico)
    let updated = ctx.store.update(deal.id, {
      amountVotes: [deal.buyerId, deal.sellerId].filter(
        (id): id is number => id != null,
      ),
      amountConfirmedAt: new Date().toISOString(),
      status: "awaiting_seller_wallet",
    })!;

    await ctx.answerCallbackQuery({ text: "Importo ok" });
    await refreshGroupTitle(ctx.api, updated);
    updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
    await postAskSellerWallet(ctx.api, ctx.store, updated);
  });

  // Opener propone Prodotto + Prezzo + Tempi in un solo messaggio (card vivente)
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

        trackSeenGroupUser(
          ctx.store,
          ctx.store.get(dealId) ?? deal,
          ctx.from.id,
        );
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

    let current = trackSeenGroupUser(ctx.store, deal, ctx.from.id);

    // Legacy: importo dual-confirm mid-flight
    if (
      current.status === "awaiting_amount" ||
      current.status === "awaiting_amount_confirm"
    ) {
      if (!isParty(current, ctx.from.id)) {
        await next();
        return;
      }
      const amount = parseAmount(text);
      if (!amount) {
        if (current.status === "awaiting_amount") {
          await ctx.reply(it.invalidAmount, { parse_mode: "Markdown" });
          return;
        }
        await next();
        return;
      }

      const updated = ctx.store.update(current.id, {
        amount,
        amountVotes: [ctx.from.id],
        amountConfirmedAt: undefined,
        status: "awaiting_amount_confirm",
      })!;
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
      await refreshGroupSetupCard(ctx.api, ctx.store, updated);
      return;
    }

    if (
      current.status !== "awaiting_tos" &&
      current.status !== "awaiting_tos_confirm"
    ) {
      await next();
      return;
    }

    if (tosAccepted(current)) {
      await ctx.reply(it.tosLocked);
      return;
    }

    if (ctx.from.id !== current.creatorId) {
      if (current.status === "awaiting_tos") {
        await ctx.reply(it.onlyOpenerWritesTerms(current), {
          parse_mode: "Markdown",
        });
        return;
      }
      await next();
      return;
    }

    const parsed = parseTermsProposal(text, current.asset);
    if (!parsed.ok) {
      if (parsed.reason === "price") {
        await ctx.reply(it.invalidTermsPrice(current.asset), {
          parse_mode: "Markdown",
        });
        return;
      }
      if (parsed.reason === "short") {
        await ctx.reply(it.tosTooShort, { parse_mode: "Markdown" });
        return;
      }
      await ctx.reply(it.termsFormatHint, { parse_mode: "Markdown" });
      return;
    }

    const tosText = composeTosText(
      parsed.product,
      parsed.amount,
      current.asset,
      parsed.tempi,
    );
    const updated = ctx.store.update(current.id, {
      tosProduct: parsed.product,
      amount: parsed.amount,
      tosConditions: parsed.tempi,
      tosText,
      tosAcceptedAt: undefined,
      amountConfirmedAt: undefined,
      amountVotes: [],
      status: "awaiting_tos_confirm",
    })!;

    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
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
