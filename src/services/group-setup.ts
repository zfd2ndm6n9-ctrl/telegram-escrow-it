import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  buyerAfterShipKeyboard,
  groupActionsKeyboard,
  shipAskKeyboard,
  tosConfirmKeyboard,
} from "../keyboards/menus.js";
import {
  amountConfirmed,
  assignJoiningParty,
  bothPartiesPresent,
  isPreDepositSetup,
  rememberSeenUser,
  termsReadyForConfirm,
  tosAccepted,
} from "./deal-logic.js";
import { startSellerTermsWizard } from "./dm-terms.js";
import { sendTrackedPrompt, upsertSetupMessage } from "./prompt-cleanup.js";

/** Keyboard della card setup (Accetto solo a proposta completa). */
export function setupCardKeyboard(deal: Deal): InlineKeyboard {
  if (
    deal.status === "awaiting_tos_confirm" &&
    termsReadyForConfirm(deal) &&
    !tosAccepted(deal)
  ) {
    return tosConfirmKeyboard(deal.id);
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

export type HumanMember = {
  id: number;
  username?: string;
  displayName?: string;
};

export type AutoBindFailure =
  | "too_many"
  | "none"
  | "need_message";

type AdminFlags = {
  can_delete_messages?: boolean;
  can_restrict_members?: boolean;
  can_invite_users?: boolean;
};

function missingFromFlags(flags: AdminFlags): RequiredBotPerm[] {
  const missing: RequiredBotPerm[] = [];
  if (!flags.can_delete_messages) missing.push("can_delete_messages");
  if (!flags.can_restrict_members) missing.push("can_restrict_members");
  if (!flags.can_invite_users) missing.push("can_invite_users");
  return missing;
}

/**
 * Verifica admin + permessi obbligatori.
 * Separato: «non admin» vs «admin ma mancano flag».
 * Fallback su getChatAdministrators se getChatMember fallisce o non vede admin
 * (evita falso negativo «deve essere amministratore» con badge admin in UI).
 */
export async function checkRequiredBotAdminPerms(
  api: Api,
  chatId: number,
): Promise<BotAdminCheck> {
  let meId: number;
  try {
    meId = (await api.getMe()).id;
  } catch (err) {
    console.warn(`checkRequiredBotAdminPerms getMe failed:`, err);
    return { ok: false, missing: [...REQUIRED_BOT_PERMS], notAdmin: true };
  }

  let status: string | undefined;
  let flags: AdminFlags | undefined;

  try {
    const member = await api.getChatMember(chatId, meId);
    status = member.status;
    if (member.status === "creator") {
      return { ok: true };
    }
    if (member.status === "administrator") {
      flags = member;
    }
  } catch (err) {
    console.warn(
      `getChatMember bot self in ${chatId} failed, provo getChatAdministrators:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (!flags) {
    try {
      const admins = await api.getChatAdministrators(chatId);
      const self = admins.find((a) => a.user.id === meId);
      if (self?.status === "creator") {
        return { ok: true };
      }
      if (self?.status === "administrator") {
        status = "administrator";
        flags = self;
      }
      // getChatAdministrators restituisce solo creator/administrator
    } catch (err) {
      console.warn(
        `getChatAdministrators ${chatId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!flags) {
    console.warn(
      `Bot non admin in ${chatId} (status=${status ?? "unknown"})`,
    );
    return { ok: false, missing: [...REQUIRED_BOT_PERMS], notAdmin: true };
  }

  const missing = missingFromFlags(flags);
  if (missing.length > 0) {
    // Admin in Telegram: non dire mai «deve essere amministratore».
    return { ok: false, missing, notAdmin: false };
  }
  return { ok: true };
}

function displayNameFromUser(user: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Scopre gli altri umani nel gruppo (non opener/creator, non bot).
 * Bot API non elenca tutti i membri: usa getChatAdministrators + getChatMember
 * su seenIds / candidateIds noti (join, /avvia, party già bound).
 */
export async function discoverOtherHumans(
  api: Api,
  chatId: number,
  openerId: number,
  seenIds: number[] = [],
  candidateIds: number[] = [],
): Promise<{ others: HumanMember[]; memberCount: number; botId: number }> {
  const me = await api.getMe();
  const botId = me.id;
  let memberCount = 0;
  try {
    memberCount = await api.getChatMemberCount(chatId);
  } catch {
    memberCount = 0;
  }

  const byId = new Map<number, HumanMember>();

  const addHuman = (user: {
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  }) => {
    if (user.is_bot || user.id === botId || user.id === openerId) return;
    byId.set(user.id, {
      id: user.id,
      username: user.username,
      displayName: displayNameFromUser(user),
    });
  };

  try {
    const admins = await api.getChatAdministrators(chatId);
    for (const m of admins) {
      addHuman(m.user);
    }
  } catch (err) {
    console.warn(`getChatAdministrators ${chatId} failed:`, err);
  }

  const probeIds = [...new Set([...seenIds, ...candidateIds])];
  for (const userId of probeIds) {
    if (userId === openerId || userId === botId || byId.has(userId)) continue;
    try {
      const member = await api.getChatMember(chatId, userId);
      const st = member.status;
      if (
        st === "left" ||
        st === "kicked" ||
        (st === "restricted" && "is_member" in member && member.is_member === false)
      ) {
        continue;
      }
      addHuman(member.user);
    } catch {
      // non in chat / sconosciuto
    }
  }

  return { others: [...byId.values()], memberCount, botId };
}

/** Persiste un umano visto nel gruppo (join / messaggio). */
export function trackSeenGroupUser(
  store: DealStore,
  deal: Deal,
  userId: number,
): Deal {
  const next = rememberSeenUser(deal, userId);
  if (!next) return deal;
  return store.update(deal.id, { seenGroupUserIds: next }) ?? deal;
}

/**
 * Assegna la controparte (ruolo opposto al DM).
 *
 * Bind solo se:
 * - `runnerId` è la controparte (ha scritto un messaggio / /avvia), oppure
 * - `runnerId` è chi è appena entrato nel gruppo (join → auto-riconoscimento).
 *
 * Se la controparte è già nel gruppo ma non ha ancora scritto, non bind
 * da sola discovery admin/API: restituisce `need_message`.
 * Fallisce anche se 0 o >1 altri umani, o se il gruppo ha troppi membri.
 */
export async function autoBindCounterpart(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
  opts?: {
    runnerId?: number;
    runnerUsername?: string;
    runnerDisplayName?: string;
  },
): Promise<
  | { ok: true; deal: Deal }
  | { ok: false; reason: AutoBindFailure; deal: Deal }
> {
  if (bothPartiesPresent(deal)) {
    return { ok: true, deal };
  }

  const openerId = deal.creatorId;
  let current = trackSeenGroupUser(store, deal, openerId);
  if (opts?.runnerId != null) {
    current = trackSeenGroupUser(store, current, opts.runnerId);
  }

  // Controparte attiva (messaggio / /avvia / join): bind immediato.
  if (
    opts?.runnerId != null &&
    opts.runnerId !== openerId &&
    !bothPartiesPresent(current)
  ) {
    const patch = assignJoiningParty(
      current,
      opts.runnerId,
      opts.runnerUsername,
      opts.runnerDisplayName,
    );
    if (
      patch &&
      (patch.buyerId === opts.runnerId || patch.sellerId === opts.runnerId)
    ) {
      const seen =
        rememberSeenUser(current, opts.runnerId) ?? current.seenGroupUserIds;
      current =
        store.update(current.id, {
          ...patch,
          ...(seen ? { seenGroupUserIds: seen } : {}),
        }) ?? current;
      if (bothPartiesPresent(current)) {
        return { ok: true, deal: current };
      }
    }
  }

  const knownPartyIds = [current.buyerId, current.sellerId].filter(
    (id): id is number => id != null,
  );
  const { others, memberCount } = await discoverOtherHumans(
    api,
    chatId,
    openerId,
    current.seenGroupUserIds ?? [],
    [
      ...knownPartyIds,
      ...(opts?.runnerId != null ? [opts.runnerId] : []),
    ],
  );

  // > buyer + seller + bot
  if (memberCount > 3) {
    return { ok: false, reason: "too_many", deal: current };
  }

  if (others.length > 1) {
    return { ok: false, reason: "too_many", deal: current };
  }

  if (others.length === 0) {
    // Membri presenti ma non ancora risolvibili via Bot API
    const reason: AutoBindFailure =
      memberCount >= 3 ? "need_message" : "none";
    return { ok: false, reason, deal: current };
  }

  const other = others[0]!;
  // Già in gruppo ma non ha scritto: non bind da discovery — chiedi un messaggio.
  if (opts?.runnerId == null || other.id !== opts.runnerId) {
    return { ok: false, reason: "need_message", deal: current };
  }

  // Fallback: runner === other (path runner sopra non ha chiuso lo slot).
  const patch = assignJoiningParty(
    current,
    other.id,
    other.username,
    other.displayName,
  );
  if (!patch || (patch.buyerId !== other.id && patch.sellerId !== other.id)) {
    return { ok: false, reason: "too_many", deal: current };
  }

  const seen = rememberSeenUser(current, other.id) ?? current.seenGroupUserIds;
  current =
    store.update(current.id, {
      ...patch,
      ...(seen ? { seenGroupUserIds: seen } : {}),
    }) ?? current;

  return { ok: true, deal: current };
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
    // Verrà risolto da auto-bind; placeholder finché non c'è la controparte
    return "awaiting_counterpart";
  }
  if (!tosAccepted(deal)) {
    return termsReadyForConfirm(deal) ? "awaiting_tos_confirm" : "awaiting_tos";
  }
  if (!amountConfirmed(deal) && deal.amount && deal.status === "awaiting_amount_confirm") {
    // Legacy mid-flight: importo proposto ma non ancora «fissato»
    return "awaiting_amount_confirm";
  }
  if (!amountConfirmed(deal)) {
    // Post-Accetto: manca ancora l'importo escrow on-chain
    return "awaiting_amount";
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
    reply_markup: groupActionsKeyboard(deal.status, deal),
  });
}

/** Dopo deposito confermato: cancella prompt deposito e chiede al seller di spedire. */
export async function postShipAsk(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  if (deal.sellerShippedAt) {
    return postBuyerAfterShip(api, store, deal);
  }
  return sendTrackedPrompt(api, store, deal, it.shipAsk(deal), {
    parse_mode: "Markdown",
    reply_markup: shipAskKeyboard(),
  });
}

/** Seller ha spedito: CTA buyer (paga / info / disputa). */
export async function postBuyerAfterShip(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return sendTrackedPrompt(api, store, deal, it.buyerAfterShip(deal), {
    parse_mode: "Markdown",
    reply_markup: buyerAfterShipKeyboard(deal),
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

export type StartDealResult = {
  deal: Deal;
  started: boolean;
  perms: BotAdminCheck;
  autoBind?: AutoBindFailure;
};

/**
 * Dopo ruoli bound: se termini pronti → Accetto; altrimenti DM wizard al seller.
 */
async function advanceToTermsOrAccetto(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  let current = deal;

  if (tosAccepted(current)) {
    return current;
  }

  if (termsReadyForConfirm(current)) {
    current =
      store.setStatus(current.id, "awaiting_tos_confirm") ?? current;
    return refreshGroupSetupCard(api, store, current);
  }

  current = store.setStatus(current.id, "awaiting_tos") ?? current;
  current = await refreshGroupSetupCard(api, store, current);

  const wizard = await startSellerTermsWizard(api, store, current);
  if (!wizard.ok && wizard.reason === "dm_blocked") {
    await api.sendMessage(current.groupChatId!, it.dmTermsSellerBlocked(current), {
      parse_mode: "Markdown",
    });
  } else if (wizard.ok) {
    current = wizard.deal;
    if (wizard.alreadyReady) {
      current =
        store.setStatus(current.id, "awaiting_tos_confirm") ?? current;
      current = await refreshGroupSetupCard(api, store, current);
    }
  }

  return current;
}

/**
 * Avvio deal in un gruppo già creato/bound: auto-bind controparte,
 * poi termini in DM seller → card Accetto (niente free-form in gruppo).
 */
export async function startDealInGroup(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
  opts?: {
    runnerId?: number;
    runnerUsername?: string;
    runnerDisplayName?: string;
  },
): Promise<StartDealResult> {
  const { deal: bound, perms } = await bindGroupToDeal(api, store, deal, chatId);
  if (!perms.ok) {
    return { deal: bound, started: false, perms };
  }

  let current = trackSeenGroupUser(store, bound, bound.creatorId);
  if (opts?.runnerId != null) {
    current = trackSeenGroupUser(store, current, opts.runnerId);
  }

  if (!bothPartiesPresent(current)) {
    const bind = await autoBindCounterpart(api, store, current, chatId, opts);
    if (!bind.ok) {
      const waiting =
        store.setStatus(bind.deal.id, "awaiting_counterpart") ?? bind.deal;
      await refreshGroupSetupCard(api, store, waiting).catch(() => undefined);
      return {
        deal: waiting,
        started: false,
        perms,
        autoBind: bind.reason,
      };
    }
    current = bind.deal;
  }

  if (current.status === "awaiting_counterpart") {
    current = store.setStatus(current.id, "awaiting_tos") ?? current;
  }

  if (!tosAccepted(current) && !isPreDepositSetup(current.status)) {
    const posted = await advanceToTermsOrAccetto(api, store, current);
    return { deal: posted, started: true, perms };
  }

  if (current.status === "awaiting_tos") {
    const posted = await advanceToTermsOrAccetto(api, store, current);
    return { deal: posted, started: true, perms };
  }
  if (current.status === "awaiting_tos_confirm") {
    if (termsReadyForConfirm(current)) {
      const posted = await postTosDraft(api, store, current);
      return { deal: posted, started: true, perms };
    }
    const posted = await advanceToTermsOrAccetto(api, store, current);
    return { deal: posted, started: true, perms };
  }
  // Legacy mid-flight amount dual-confirm
  if (current.status === "awaiting_amount") {
    const posted = await postAskAmount(api, store, current);
    return { deal: posted, started: true, perms };
  }
  if (current.status === "awaiting_amount_confirm" && current.amount) {
    const posted = await postAmountProposed(api, store, current);
    return { deal: posted, started: true, perms };
  }
  if (current.status === "awaiting_seller_wallet") {
    const posted = await postAskSellerWallet(api, store, current);
    return { deal: posted, started: true, perms };
  }
  if (current.status === "awaiting_buyer_wallet") {
    const posted = await postAskBuyerWallet(api, store, current);
    return { deal: posted, started: true, perms };
  }

  if (bothPartiesPresent(current) && !tosAccepted(current)) {
    const posted = await advanceToTermsOrAccetto(api, store, current);
    return { deal: posted, started: true, perms };
  }

  return { deal: current, started: true, perms };
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
