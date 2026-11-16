import type { Api } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  counterpartConfirmKeyboard,
  groupActionsKeyboard,
  tosConfirmKeyboard,
} from "../keyboards/menus.js";
import {
  bothPartiesPresent,
  isPreDepositSetup,
  tosAccepted,
} from "./deal-logic.js";

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
      }) ?? deal;
    return { deal: updated, perms };
  }

  try {
    await api.setChatTitle(chatId, it.groupTitle(deal));
  } catch {
    // ok se manca can_change_info
  }

  const nextStatus = resolveBoundStatus(deal);

  const updated =
    store.update(deal.id, {
      groupChatId: chatId,
      status: nextStatus,
    }) ?? deal;

  return { deal: updated, perms };
}

function resolveBoundStatus(deal: Deal): Deal["status"] {
  const advanced: Deal["status"][] = [
    "awaiting_deposit",
    "funded",
    "release_pending",
    "refund_pending",
    "released",
    "refunded",
    "disputed",
    "awaiting_tos",
    "awaiting_tos_confirm",
    "awaiting_seller_wallet",
    "awaiting_buyer_wallet",
  ];
  if (advanced.includes(deal.status)) {
    return deal.status;
  }
  if (!bothPartiesPresent(deal)) {
    return "awaiting_counterpart";
  }
  if (!tosAccepted(deal)) {
    return deal.tosText ? "awaiting_tos_confirm" : "awaiting_tos";
  }
  if (!deal.sellerWallet) return "awaiting_seller_wallet";
  if (!deal.buyerWallet) return "awaiting_buyer_wallet";
  return "awaiting_deposit";
}

export async function postStabilizeTos(api: Api, deal: Deal): Promise<void> {
  if (deal.groupChatId == null) return;
  await api.sendMessage(deal.groupChatId, it.stabilizeTos(deal), {
    parse_mode: "Markdown",
  });
}

export async function postTosDraft(api: Api, deal: Deal): Promise<void> {
  if (deal.groupChatId == null || !deal.tosText) return;
  await api.sendMessage(deal.groupChatId, it.tosDraftPosted(deal), {
    parse_mode: "Markdown",
    reply_markup: tosConfirmKeyboard(deal.id),
  });
}

export async function postAskSellerWallet(api: Api, deal: Deal): Promise<void> {
  if (deal.groupChatId == null) return;
  await api.sendMessage(deal.groupChatId, it.askSellerWallet(deal), {
    parse_mode: "Markdown",
  });
}

export async function postAskBuyerWallet(api: Api, deal: Deal): Promise<void> {
  if (deal.groupChatId == null) return;
  await api.sendMessage(deal.groupChatId, it.askBuyerWallet(deal), {
    parse_mode: "Markdown",
  });
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

/**
 * Avvio deal in un gruppo già creato/bound: chiede conferma controparte
 * oppure riprende ToS/wallet se le parti ci sono già.
 */
export async function startDealInGroup(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
): Promise<{ deal: Deal; started: boolean; perms: BotAdminCheck }> {
  const { deal: bound, perms } = await bindGroupToDeal(api, store, deal, chatId);
  if (!perms.ok) {
    return { deal: bound, started: false, perms };
  }

  if (bothPartiesPresent(bound)) {
    if (!tosAccepted(bound) && !isPreDepositSetup(bound.status)) {
      const waitingTos = store.setStatus(bound.id, "awaiting_tos") ?? bound;
      await postStabilizeTos(api, waitingTos);
      return { deal: waitingTos, started: true, perms };
    }
    if (bound.status === "awaiting_tos") {
      await postStabilizeTos(api, bound);
      return { deal: bound, started: true, perms };
    }
    if (bound.status === "awaiting_tos_confirm" && bound.tosText) {
      await postTosDraft(api, bound);
      return { deal: bound, started: true, perms };
    }
    if (bound.status === "awaiting_seller_wallet") {
      await postAskSellerWallet(api, bound);
      return { deal: bound, started: true, perms };
    }
    return { deal: bound, started: true, perms };
  }

  const waiting = store.setStatus(bound.id, "awaiting_counterpart") ?? bound;
  await api.sendMessage(chatId, it.askCounterpartConfirm(waiting), {
    parse_mode: "Markdown",
    reply_markup: counterpartConfirmKeyboard(waiting.id),
  });
  return { deal: waiting, started: true, perms };
}

export async function kickUnauthorized(
  api: Api,
  chatId: number,
  userId: number,
  opts?: { silent?: boolean; notice?: string },
): Promise<void> {
  try {
    await api.banChatMember(chatId, userId);
    await api.unbanChatMember(chatId, userId);
    if (opts?.silent) return;
    await api.sendMessage(chatId, opts?.notice ?? it.kickedExtra(userId), {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.warn(`kick ${userId} failed:`, err);
  }
}
