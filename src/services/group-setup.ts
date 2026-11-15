import type { Api } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";

export type RequiredBotPerm =
  | "can_delete_messages"
  | "can_restrict_members"
  | "can_invite_users";

export const REQUIRED_BOT_PERMS: RequiredBotPerm[] = [
  "can_delete_messages",
  "can_restrict_members",
  "can_invite_users",
];

export type BotAdminCheck =
  | { ok: true }
  | { ok: false; missing: RequiredBotPerm[]; notAdmin: boolean };

/**
 * Verifica admin + permessi obbligatori via getChatMember.
 * Creator del gruppo ⇒ ok. Altrimenti servono i tre flag.
 */
export async function checkRequiredBotAdminPerms(
  api: Api,
  chatId: number,
): Promise<BotAdminCheck> {
  try {
    const me = await api.getMe();
    const member = await api.getChatMember(chatId, me.id);

    if (member.status === "creator") {
      return { ok: true };
    }

    if (member.status !== "administrator") {
      return { ok: false, missing: [...REQUIRED_BOT_PERMS], notAdmin: true };
    }

    const missing: RequiredBotPerm[] = [];
    if (!member.can_delete_messages) missing.push("can_delete_messages");
    if (!member.can_restrict_members) missing.push("can_restrict_members");
    if (!member.can_invite_users) missing.push("can_invite_users");

    if (missing.length > 0) {
      return { ok: false, missing, notAdmin: false };
    }
    return { ok: true };
  } catch {
    return { ok: false, missing: [...REQUIRED_BOT_PERMS], notAdmin: true };
  }
}

/**
 * Collega il gruppo al deal solo se i permessi admin obbligatori sono ok.
 * Altrimenti lascia awaiting_bot_admin e non avvia escrow.
 */
export async function bindGroupToDeal(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
): Promise<{ deal: Deal; perms: BotAdminCheck }> {
  const perms = await checkRequiredBotAdminPerms(api, chatId);

  if (!perms.ok) {
    const updated =
      store.update(deal.id, {
        groupChatId: chatId,
        status: "awaiting_bot_admin",
        groupInviteLink: undefined,
      }) ?? deal;
    return { deal: updated, perms };
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

  return { deal: updated, perms };
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
