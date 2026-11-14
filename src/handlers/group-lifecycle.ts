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
  ensureGroupConfigured,
  kickUnauthorized,
  postGroupWelcome,
} from "../services/group-setup.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";

async function onHumanJoined(
  ctx: BotContext,
  chatId: number,
  userId: number,
  username: string | undefined,
): Promise<void> {
  const deal = ctx.store.findByGroupChatId(chatId);
  if (!deal) return;

  if (isAllowedHuman(deal, userId)) {
    const patch = assignJoiningParty(deal, userId, username);
    if (patch) {
      let updated = ctx.store.update(deal.id, patch)!;
      if (bothPartiesPresent(updated) && updated.status === "awaiting_counterpart") {
        updated = ctx.store.setStatus(updated.id, "awaiting_deposit")!;
        await ctx.api.sendMessage(chatId, it.counterpartJoined(updated), {
          parse_mode: "Markdown",
          reply_markup: groupActionsKeyboard(updated.status),
        });
      }
    }
    return;
  }

  // Non ancora party: prova ad assegnare lo slot controparte libero
  const patch = assignJoiningParty(deal, userId, username);
  if (patch && (patch.buyerId === userId || patch.sellerId === userId)) {
    let updated = ctx.store.update(deal.id, patch)!;
    if (bothPartiesPresent(updated) && updated.status === "awaiting_counterpart") {
      updated = ctx.store.setStatus(updated.id, "awaiting_deposit")!;
      await ctx.api.sendMessage(chatId, it.counterpartJoined(updated), {
        parse_mode: "Markdown",
        reply_markup: groupActionsKeyboard(updated.status),
      });
    }
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

    // Se già collegato e diventiamo admin, completa setup
    let deal = ctx.store.findByGroupChatId(chat.id);
    if (!deal) {
      deal = ctx.store.findAwaitingGroupByCreator(update.from.id);
    }
    if (!deal) {
      console.log(
        `my_chat_member: nessun deal per user ${update.from.id} chat ${chat.id}`,
      );
      return;
    }

    const configured = await ensureGroupConfigured(ctx.api, ctx.store, deal, chat.id);

    if (configured.status === "awaiting_bot_admin") {
      await ctx.api.sendMessage(chat.id, it.needBotAdmin, { parse_mode: "Markdown" });
      return;
    }

    await postGroupWelcome(ctx.api, configured);
    console.log(`Gruppo collegato deal #${configured.id} chat=${chat.id}`);
  });

  bot.command("setup", async (ctx) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;

    let deal =
      ctx.store.findByGroupChatId(ctx.chat.id) ??
      ctx.store.findAwaitingGroupByCreator(ctx.from.id);

    if (!deal) {
      await ctx.reply(it.noDealInGroup);
      return;
    }

    deal = await ensureGroupConfigured(ctx.api, ctx.store, deal, ctx.chat.id);
    if (deal.status === "awaiting_bot_admin") {
      await ctx.reply(it.needBotAdmin, { parse_mode: "Markdown" });
      return;
    }

    await postGroupWelcome(ctx.api, deal);
  });

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
      await ctx.reply("Questo deal è già collegato a un altro gruppo.");
      return;
    }

    const configured = await ensureGroupConfigured(
      ctx.api,
      ctx.store,
      deal,
      ctx.chat.id,
    );
    if (configured.status === "awaiting_bot_admin") {
      await ctx.reply(it.needBotAdmin, { parse_mode: "Markdown" });
    } else {
      await postGroupWelcome(ctx.api, configured);
    }
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
