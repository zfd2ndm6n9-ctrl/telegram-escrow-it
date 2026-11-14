import type { Api } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";
import { bothPartiesPresent } from "./deal-logic.js";

export async function botHasInvitePermission(
  api: Api,
  chatId: number,
): Promise<boolean> {
  try {
    const me = await api.getChatMember(chatId, (await api.getMe()).id);
    if (me.status === "creator") return true;
    if (me.status === "administrator") {
      return Boolean(me.can_invite_users);
    }
    return false;
  } catch {
    return false;
  }
}

export async function ensureGroupConfigured(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
): Promise<Deal> {
  const canInvite = await botHasInvitePermission(api, chatId);
  if (!canInvite) {
    return (
      store.update(deal.id, {
        groupChatId: chatId,
        status: "awaiting_bot_admin",
      }) ?? deal
    );
  }

  let invite = deal.groupInviteLink;
  if (!invite) {
    try {
      const link = await api.createChatInviteLink(chatId, {
        name: `counterpart-${deal.id}`,
        member_limit: 1,
      });
      invite = link.invite_link;
    } catch (err) {
      console.warn("createChatInviteLink failed:", err);
    }
  }

  try {
    await api.setChatTitle(chatId, it.groupTitle(deal));
  } catch {
    // ok se manca can_change_info
  }

  const status = bothPartiesPresent(deal)
    ? deal.status === "awaiting_group" ||
      deal.status === "awaiting_bot_admin" ||
      deal.status === "awaiting_counterpart"
      ? "awaiting_deposit"
      : deal.status
    : "awaiting_counterpart";

  return (
    store.update(deal.id, {
      groupChatId: chatId,
      groupInviteLink: invite,
      status,
    }) ?? deal
  );
}

export async function postGroupWelcome(
  api: Api,
  deal: Deal,
): Promise<void> {
  if (deal.groupChatId == null) return;

  await api.sendMessage(deal.groupChatId, it.groupBound(deal), {
    parse_mode: "Markdown",
    reply_markup: groupActionsKeyboard(deal.status),
  });

  if (deal.groupInviteLink && deal.status === "awaiting_counterpart") {
    await api.sendMessage(
      deal.groupChatId,
      it.inviteCounterpart(deal.groupInviteLink),
      { parse_mode: "Markdown" },
    );
  }

  if (deal.status === "awaiting_deposit") {
    await api.sendMessage(deal.groupChatId, it.counterpartJoined(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
  }
}

export async function createAdminInviteLink(
  api: Api,
  chatId: number,
  dealId: string,
): Promise<string | undefined> {
  try {
    const link = await api.createChatInviteLink(chatId, {
      name: `admin-dispute-${dealId}`,
      member_limit: 1,
    });
    return link.invite_link;
  } catch (err) {
    console.warn("admin invite link failed:", err);
    return undefined;
  }
}

export async function kickUnauthorized(
  api: Api,
  chatId: number,
  userId: number,
): Promise<void> {
  try {
    await api.banChatMember(chatId, userId);
    await api.unbanChatMember(chatId, userId);
    await api.sendMessage(chatId, it.kickedExtra(userId), {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.warn(`kick ${userId} failed:`, err);
  }
}
