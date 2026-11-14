import type { Api } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";

export async function botIsAdministrator(api: Api, chatId: number): Promise<boolean> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

export async function botCanRestrict(api: Api, chatId: number): Promise<boolean> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);
    if (member.status === "creator") return true;
    if (member.status === "administrator") {
      return Boolean(member.can_restrict_members);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Collega il gruppo al deal e verifica che il bot sia admin.
 * Non crea più invite link per la controparte.
 */
export async function bindGroupToDeal(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
): Promise<{ deal: Deal; isAdmin: boolean }> {
  const isAdmin = await botIsAdministrator(api, chatId);

  if (!isAdmin) {
    const updated =
      store.update(deal.id, {
        groupChatId: chatId,
        status: "awaiting_bot_admin",
        groupInviteLink: undefined,
      }) ?? deal;
    return { deal: updated, isAdmin: false };
  }

  try {
    await api.setChatTitle(chatId, it.groupTitle(deal));
  } catch {
    // ok se manca can_change_info
  }

  const nextStatus =
    deal.buyerId != null && deal.sellerId != null
      ? deal.status === "awaiting_deposit" ||
        deal.status === "funded" ||
        deal.status === "release_pending" ||
        deal.status === "refund_pending" ||
        deal.status === "released" ||
        deal.status === "refunded" ||
        deal.status === "disputed"
        ? deal.status
        : "awaiting_deposit"
      : "awaiting_counterpart";

  const updated =
    store.update(deal.id, {
      groupChatId: chatId,
      status: nextStatus,
      groupInviteLink: undefined,
    }) ?? deal;

  return { deal: updated, isAdmin: true };
}

export async function postDealActivated(api: Api, deal: Deal): Promise<void> {
  if (deal.groupChatId == null) return;
  await api.sendMessage(deal.groupChatId, it.dealActivated(deal), {
    parse_mode: "Markdown",
    reply_markup: groupActionsKeyboard(deal.status),
  });
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
