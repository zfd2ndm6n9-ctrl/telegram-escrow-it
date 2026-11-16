import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  amountConfirmKeyboard,
  counterpartConfirmKeyboard,
  groupActionsKeyboard,
  tosConfirmKeyboard,
} from "../keyboards/menus.js";
import {
  amountConfirmed,
  bothPartiesPresent,
  isPreDepositSetup,
  tosAccepted,
} from "./deal-logic.js";
import { sendTrackedPrompt, upsertSetupMessage } from "./prompt-cleanup.js";

/** Keyboard della card setup vivente (o vuota per togliere i pulsanti). */
export function setupCardKeyboard(deal: Deal): InlineKeyboard {
  if (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") {
    return counterpartConfirmKeyboard(deal.id);
  }
  if (deal.status === "awaiting_tos_confirm" && !tosAccepted(deal)) {
    return tosConfirmKeyboard(deal.id);
  }
  if (
    deal.status === "awaiting_amount_confirm" &&
    deal.amount &&
    !amountConfirmed(deal)
  ) {
    return amountConfirmKeyboard(deal.id);
  }
  return new InlineKeyboard();
}

/** Aggiorna (o crea) l'unico messaggio di setup del deal. */
export async function refreshGroupSetupCard(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return upsertSetupMessage(api, store, deal, it.groupSetupCard(deal), {
    parse_mode: "Markdown",
    reply_markup: setupCardKeyboard(deal),
  });
}

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
    "awaiting_amount",
    "awaiting_amount_confirm",
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
    return deal.tosProduct && deal.tosConditions
      ? "awaiting_tos_confirm"
      : "awaiting_tos";
  }
  if (!amountConfirmed(deal)) {
    return deal.amount ? "awaiting_amount_confirm" : "awaiting_amount";
  }
  if (!deal.sellerWallet) return "awaiting_seller_wallet";
  if (!deal.buyerWallet) return "awaiting_buyer_wallet";
  return "awaiting_deposit";
}

export async function postStabilizeTos(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return refreshGroupSetupCard(api, store, deal);
}

export async function postTosDraft(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  if (!deal.tosText) return deal;
  return refreshGroupSetupCard(api, store, deal);
}

export async function postAskTosConditions(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return refreshGroupSetupCard(api, store, deal);
}

export async function postAskAmount(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return refreshGroupSetupCard(api, store, deal);
}

export async function postAmountProposed(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return refreshGroupSetupCard(api, store, deal);
}

export async function postAskSellerWallet(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return sendTrackedPrompt(api, store, deal, it.askSellerWallet(deal), {
    parse_mode: "Markdown",
  });
}

/** Aggiorna titolo gruppo con importo (best-effort). */
export async function refreshGroupTitle(
  api: Api,
  deal: Deal,
): Promise<void> {
  if (deal.groupChatId == null) return;
  try {
    await api.setChatTitle(deal.groupChatId, it.groupTitle(deal));
  } catch {
    // ok se manca can_change_info
  }
}

export async function postAskBuyerWallet(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return sendTrackedPrompt(api, store, deal, it.askBuyerWallet(deal), {
    parse_mode: "Markdown",
  });
}

export async function postDealActivated(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return sendTrackedPrompt(api, store, deal, it.dealActivated(deal), {
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
      const posted = await postStabilizeTos(api, store, waitingTos);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_tos") {
      if (bound.tosProduct && !bound.tosConditions) {
        const posted = await postAskTosConditions(api, store, bound);
        return { deal: posted, started: true, perms };
      }
      const posted = await postStabilizeTos(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_tos_confirm" && bound.tosText) {
      const posted = await postTosDraft(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_amount") {
      const posted = await postAskAmount(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_amount_confirm" && bound.amount) {
      const posted = await postAmountProposed(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_seller_wallet") {
      const posted = await postAskSellerWallet(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    if (bound.status === "awaiting_buyer_wallet") {
      const posted = await postAskBuyerWallet(api, store, bound);
      return { deal: posted, started: true, perms };
    }
    return { deal: bound, started: true, perms };
  }

  const waiting = store.setStatus(bound.id, "awaiting_counterpart") ?? bound;
  const posted = await refreshGroupSetupCard(api, store, waiting);
  return { deal: posted, started: true, perms };
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
