import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Api } from "grammy";
import { InlineKeyboard, InputFile } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import { it } from "../messages/it.js";
import {
  buyerAfterShipKeyboard,
  counterpartBindConfirmKeyboard,
  groupActionsKeyboard,
  shipAskKeyboard,
  tosConfirmKeyboard,
} from "../keyboards/menus.js";
import {
  amountConfirmed,
  assignJoiningParty,
  bothPartiesPresent,
  canBindAsDealParty,
  isPreDepositSetup,
  isSupportHelperUser,
  rememberSeenUser,
  termsReadyForConfirm,
  tosAccepted,
} from "./deal-logic.js";
import { clearDmTermsUi, startTermsWizard } from "./dm-terms.js";
import {
  extractMigrateToChatId,
  remapDealGroupChatId,
  resolveLiveChatId,
  syncDealLiveChatId,
} from "./group-chat-remap.js";
import {
  demoteNonOwnerHumanAdmins,
  hardenGroupPermissions,
} from "./group-creator.js";
import { ensureGroupTosMiniAppPin } from "./group-tos-pin.js";
import {
  clearEphemeralReplies,
  clearRoleError,
  deleteMessageSafe,
  sendTrackedPrompt,
  upsertSetupMessage,
} from "./prompt-cleanup.js";


/** PNG branding gruppi deal (repo `assets/`, non compilato in dist/). */
const GROUP_PHOTO_FILENAME = "escrowita-group.png";

/**
 * Best-effort: pulisce DM create-flow del creator quando il bot è nel gruppo
 * o /avvia avvia il deal — istruzioni «aggiungi bot», termini residuali, TTL.
 */
export async function clearAwaitingGroupDmHints(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const hasHints =
    deal.awaitingGroupExpiresAt != null ||
    deal.dmGroupInstructionsMessageId != null ||
    deal.dmTermsPromptMessageId != null ||
    deal.dmTermsSummaryMessageId != null;
  if (!hasHints) return deal;

  if (deal.dmGroupInstructionsMessageId != null) {
    await deleteMessageSafe(
      api,
      deal.creatorId,
      deal.dmGroupInstructionsMessageId,
    );
  }

  let current =
    store.update(deal.id, {
      awaitingGroupExpiresAt: undefined,
      dmGroupInstructionsMessageId: undefined,
    }) ?? deal;

  // Termini DM già chiusi di solito; ripulisci residui se presenti.
  current = await clearDmTermsUi(api, store, current, current.creatorId);
  return current;
}

/**
 * Path assoluto a `assets/escrowita-group.png`.
 * Risolve da `import.meta` (dist/src → package root) con fallback su cwd.
 */
export function resolveGroupPhotoPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "assets", GROUP_PHOTO_FILENAME),
    path.resolve(process.cwd(), "assets", GROUP_PHOTO_FILENAME),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Imposta la foto profilo del gruppo deal (best-effort).
 * Richiede admin + can_change_info (stesso diritto di setChatTitle).
 * Soft-fail: log e continua.
 */
export async function ensureEscrowitaGroupPhoto(
  api: Api,
  chatId: number,
): Promise<boolean> {
  const photoPath = resolveGroupPhotoPath();
  if (!photoPath) {
    console.warn(
      `setChatPhoto ${chatId}: asset mancante (assets/${GROUP_PHOTO_FILENAME})`,
    );
    return false;
  }
  try {
    await api.setChatPhoto(chatId, new InputFile(photoPath));
    return true;
  } catch (err) {
    console.warn(
      `setChatPhoto ${chatId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Keyboard della card setup:
 * - awaiting counterpart (helper): nessun bottone — due messaggi separati (link + Invita)
 * - Accetta / Proponi a proposta completa (callback; niente Mini App)
 */
export function setupCardKeyboard(deal: Deal): InlineKeyboard {
  if (
    (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") &&
    deal.groupCreatedVia === "helper" &&
    deal.counterpartInviteLink
  ) {
    return new InlineKeyboard();
  }
  if (
    deal.status === "awaiting_tos_confirm" &&
    termsReadyForConfirm(deal) &&
    !tosAccepted(deal)
  ) {
    return tosConfirmKeyboard(deal.id);
  }
  return new InlineKeyboard();
}

function isHelperAwaitingCounterpart(deal: Deal): boolean {
  return (
    (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") &&
    deal.groupCreatedVia === "helper" &&
    Boolean(deal.counterpartInviteLink)
  );
}

/** True se i due messaggi invite (A+B) sono già nel gruppo. */
export function hasCounterpartInviteMessages(deal: Deal): boolean {
  return (
    deal.counterpartInviteLinkMessageId != null &&
    deal.counterpartInviteHintMessageId != null
  );
}

/**
 * Cancella i due messaggi invite (A link + B «Invita il …») e azzera gli id.
 * Chiamare al join controparte prima della card ToS.
 */
export async function clearCounterpartInviteMessages(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId == null) {
    return (
      store.update(deal.id, {
        counterpartInviteLinkMessageId: undefined,
        counterpartInviteHintMessageId: undefined,
      }) ?? deal
    );
  }
  if (deal.counterpartInviteLinkMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.counterpartInviteLinkMessageId);
  }
  if (deal.counterpartInviteHintMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.counterpartInviteHintMessageId);
  }
  return (
    store.update(deal.id, {
      counterpartInviteLinkMessageId: undefined,
      counterpartInviteHintMessageId: undefined,
    }) ?? deal
  );
}

/**
 * Cancella i DM invite-link del creator (e simili) quando la controparte entra.
 * Best-effort: messaggio già cancellato / chat privata → skip.
 */
export async function clearCreatorInviteDms(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const ids = deal.dmCreatorInviteMessageIds;
  if (!ids?.length) return deal;
  for (const msgId of ids) {
    await deleteMessageSafe(api, deal.creatorId, msgId);
  }
  return (
    store.update(deal.id, { dmCreatorInviteMessageIds: undefined }) ?? deal
  );
}

/**
 * Helper awaiting: due messaggi separati —
 * (A) solo invite link, (B) «Invita il buyer/seller».
 * Idempotente se entrambi già tracciati.
 */
export async function postHelperCounterpartInvite(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  const link = deal.counterpartInviteLink;
  if (chatId == null || !link) return deal;

  let current = deal;

  // Vecchio modello: una sola living card → elimina prima dei due messaggi.
  if (current.setupMessageId != null) {
    await deleteMessageSafe(api, chatId, current.setupMessageId);
    current =
      store.update(current.id, { setupMessageId: undefined }) ?? current;
  }

  if (hasCounterpartInviteMessages(current)) {
    return current;
  }

  // Se ne manca uno (crash mid-post), ripulisci e riposta entrambi.
  if (
    current.counterpartInviteLinkMessageId != null ||
    current.counterpartInviteHintMessageId != null
  ) {
    current = await clearCounterpartInviteMessages(api, store, current);
  }

  try {
    const linkMsg = await api.sendMessage(chatId, link);
    const hintMsg = await api.sendMessage(
      chatId,
      it.invitaMissingParty(current.creatorRole),
    );
    return (
      store.update(current.id, {
        counterpartInviteLinkMessageId: linkMsg.message_id,
        counterpartInviteHintMessageId: hintMsg.message_id,
      }) ?? current
    );
  } catch (err) {
    console.warn(
      `postHelperCounterpartInvite ${chatId} failed:`,
      err instanceof Error ? err.message : err,
    );
    return store.get(current.id) ?? current;
  }
}

/**
 * Aggiorna (o crea) la card setup.
 * Helper awaiting → due messaggi invite (non una living card).
 * Con entrambe le parti → cancella invite A+B, poi card ToS.
 * Termini pronti → pin Mini App ToS (sola lettura) prima della card.
 */
export async function refreshGroupSetupCard(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  if (isHelperAwaitingCounterpart(deal)) {
    return postHelperCounterpartInvite(api, store, deal);
  }

  let current = deal;
  if (
    current.counterpartInviteLinkMessageId != null ||
    current.counterpartInviteHintMessageId != null
  ) {
    current = await clearCounterpartInviteMessages(api, store, current);
  }
  // Controparte presente → pulisci anche i DM invite del creator.
  if (
    bothPartiesPresent(current) &&
    (current.dmCreatorInviteMessageIds?.length ?? 0) > 0
  ) {
    current = await clearCreatorInviteDms(api, store, current);
  }

  if (
    !tosAccepted(current) &&
    current.status === "awaiting_tos_confirm" &&
    termsReadyForConfirm(current)
  ) {
    current = await ensureGroupTosMiniAppPin(api, store, current);
  }

  return upsertSetupMessage(api, store, current, it.groupSetupCard(current), {
    parse_mode: "Markdown",
    reply_markup: setupCardKeyboard(current),
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
  | "need_message"
  /** Path manuale: creator deve confermare la controparte candidata (A1). */
  | "need_confirm";

/** Helper dual-link `member_limit:1`: auto-bind sicuro senza confirm creator. */
export function isHelperSafeAutoBind(deal: Deal): boolean {
  return (
    deal.groupCreatedVia === "helper" && Boolean(deal.counterpartInviteLink)
  );
}

function clearPendingCounterpartPatch(): Partial<Deal> {
  return {
    pendingCounterpartUserId: undefined,
    pendingCounterpartUsername: undefined,
    pendingCounterpartDisplayName: undefined,
  };
}

/**
 * Path manuale / ambiguo: salva candidato e chiede conferma al creator.
 * Se c'è già un altro pending → too_many (kick extra lato caller).
 */
function parkPendingCounterpart(
  store: DealStore,
  deal: Deal,
  runnerId: number,
  runnerUsername?: string,
  runnerDisplayName?: string,
): { ok: false; reason: AutoBindFailure; deal: Deal } {
  if (
    deal.pendingCounterpartUserId != null &&
    deal.pendingCounterpartUserId !== runnerId
  ) {
    return { ok: false, reason: "too_many", deal };
  }
  const next =
    store.update(deal.id, {
      pendingCounterpartUserId: runnerId,
      pendingCounterpartUsername: runnerUsername,
      pendingCounterpartDisplayName: runnerDisplayName,
    }) ?? deal;
  return { ok: false, reason: "need_confirm", deal: next };
}

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
    // Helper/support owner non è una controparte candidata.
    if (isSupportHelperUser(user.id)) return;
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

  // Controparte attiva (messaggio / /avvia / join).
  // Helper dual-link: bind immediato (member_limit:1).
  // Manuale / ambiguo: pending + conferma creator (A1) — no first-join silent.
  // Mai il helper/support (owner MTProto) — solo le due parti invite-link.
  if (
    opts?.runnerId != null &&
    opts.runnerId !== openerId &&
    canBindAsDealParty(current, opts.runnerId) &&
    !bothPartiesPresent(current)
  ) {
    if (!isHelperSafeAutoBind(current)) {
      return parkPendingCounterpart(
        store,
        current,
        opts.runnerId,
        opts.runnerUsername,
        opts.runnerDisplayName,
      );
    }
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
          ...clearPendingCounterpartPatch(),
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
      ...(opts?.runnerId != null && canBindAsDealParty(current, opts.runnerId)
        ? [opts.runnerId]
        : []),
    ],
  );

  // Manuale: bot + buyer + seller (=3). Helper-owned: + owner supporto (=4).
  const maxMembers = current.groupCreatedVia === "helper" ? 4 : 3;
  if (memberCount > maxMembers) {
    return { ok: false, reason: "too_many", deal: current };
  }

  if (others.length > 1) {
    return { ok: false, reason: "too_many", deal: current };
  }

  if (others.length === 0) {
    // Membri presenti ma non ancora risolvibili via Bot API
    const reason: AutoBindFailure =
      memberCount >= maxMembers ? "need_message" : "none";
    return { ok: false, reason, deal: current };
  }

  const other = others[0]!;
  if (!canBindAsDealParty(current, other.id)) {
    return { ok: false, reason: "need_message", deal: current };
  }
  // Già in gruppo ma non ha scritto: non bind da discovery — chiedi un messaggio.
  if (opts?.runnerId == null || other.id !== opts.runnerId) {
    return { ok: false, reason: "need_message", deal: current };
  }

  // Fallback: runner === other (path runner sopra non ha chiuso lo slot).
  if (!isHelperSafeAutoBind(current)) {
    return parkPendingCounterpart(
      store,
      current,
      other.id,
      other.username,
      other.displayName,
    );
  }

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
      ...clearPendingCounterpartPatch(),
      ...(seen ? { seenGroupUserIds: seen } : {}),
    }) ?? current;

  return { ok: true, deal: current };
}

/** Prompt creator: conferma controparte candidata (igiene via botPromptIds). */
export async function ensureCounterpartConfirmPrompt(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const pendingId = deal.pendingCounterpartUserId;
  if (pendingId == null || deal.groupChatId == null) return deal;
  const role: "buyer" | "seller" =
    deal.creatorRole === "buyer" ? "seller" : "buyer";
  const who = deal.pendingCounterpartUsername
    ? `@${deal.pendingCounterpartUsername}`
    : deal.pendingCounterpartDisplayName?.trim() || `id ${pendingId}`;
  return sendTrackedPrompt(
    api,
    store,
    deal,
    it.counterpartConfirmAsk({ dealId: deal.id, who, role }),
    {
      parse_mode: "Markdown",
      reply_markup: counterpartBindConfirmKeyboard(deal.id),
    },
  );
}

/**
 * Creator conferma il pending → bind reale + clear pending.
 */
export function applyCounterpartConfirm(
  store: DealStore,
  deal: Deal,
  creatorId: number,
):
  | { ok: true; deal: Deal }
  | { ok: false; reason: "not_creator" | "no_pending" | "bind_failed"; deal: Deal } {
  if (creatorId !== deal.creatorId) {
    return { ok: false, reason: "not_creator", deal };
  }
  const pendingId = deal.pendingCounterpartUserId;
  if (pendingId == null) {
    return { ok: false, reason: "no_pending", deal };
  }
  const patch = assignJoiningParty(
    deal,
    pendingId,
    deal.pendingCounterpartUsername,
    deal.pendingCounterpartDisplayName,
  );
  if (
    !patch ||
    (patch.buyerId !== pendingId && patch.sellerId !== pendingId)
  ) {
    return { ok: false, reason: "bind_failed", deal };
  }
  const seen = rememberSeenUser(deal, pendingId) ?? deal.seenGroupUserIds;
  const next =
    store.update(deal.id, {
      ...patch,
      ...clearPendingCounterpartPatch(),
      ...(seen ? { seenGroupUserIds: seen } : {}),
    }) ?? deal;
  return { ok: true, deal: next };
}

/**
 * Creator rifiuta: clear pending; caller kicka il candidato.
 */
export function applyCounterpartReject(
  store: DealStore,
  deal: Deal,
  creatorId: number,
):
  | { ok: true; deal: Deal; rejectedUserId: number }
  | { ok: false; reason: "not_creator" | "no_pending"; deal: Deal } {
  if (creatorId !== deal.creatorId) {
    return { ok: false, reason: "not_creator", deal };
  }
  const rejectedUserId = deal.pendingCounterpartUserId;
  if (rejectedUserId == null) {
    return { ok: false, reason: "no_pending", deal };
  }
  const next =
    store.update(deal.id, clearPendingCounterpartPatch()) ?? deal;
  return { ok: true, deal: next, rejectedUserId };
}

/**
 * Collega il gruppo al deal solo se i permessi admin obbligatori sono ok.
 * Altrimenti lascia awaiting_bot_admin e non avvia escrow.
 *
 * Dopo title/photo Telegram può migrare group→supergroup (nuovo chat id):
 * risolviamo l'id live prima di persistere `groupChatId`.
 */
export async function bindGroupToDeal(
  api: Api,
  store: DealStore,
  deal: Deal,
  chatId: number,
): Promise<{ deal: Deal; perms: BotAdminCheck }> {
  const perms = await checkRequiredBotAdminPerms(api, chatId);

  if (!perms.ok) {
    const liveId = await resolveLiveChatId(api, chatId);
    let updated =
      store.update(deal.id, {
        groupChatId: liveId,
        status: "awaiting_bot_admin",
        awaitingGroupExpiresAt: undefined,
      }) ?? deal;
    updated = await clearAwaitingGroupDmHints(api, store, updated);
    return { deal: updated, perms };
  }

  // Non rinominare qui: un setChatTitle early (solo Escrow #id) race con il
  // titolo umano e Telegram logga «X ha cambiato il nome…» come se l'utente
  // annullasse il bot. Titolo completo (con importo) solo a ToS/amount lock
  // via refreshGroupTitle.

  // Foto branding una sola volta (non a ogni rename / /avvia).
  // setChatPhoto su basic group spesso triggera migrazione → nuovo id.
  // Niente getChat preliminare: stesso path su super/basic (migrazione gestita sotto).
  let groupPhotoSetAt = deal.groupPhotoSetAt;
  let liveId: number;
  if (!groupPhotoSetAt) {
    const [photoOk, resolvedId] = await Promise.all([
      ensureEscrowitaGroupPhoto(api, chatId),
      resolveLiveChatId(api, chatId),
    ]);
    if (photoOk) {
      groupPhotoSetAt = new Date().toISOString();
    }
    liveId = resolvedId;
  } else {
    liveId = await resolveLiveChatId(api, chatId);
  }
  if (liveId !== chatId) {
    console.log(
      `bindGroupToDeal #${deal.id}: chat migrated ${chatId} → ${liveId}`,
    );
  }

  const nextStatus = resolveBoundStatus(deal);

  let updated =
    store.update(deal.id, {
      groupChatId: liveId,
      status: nextStatus,
      awaitingGroupExpiresAt: undefined,
      // Helper path already sets groupCreatedVia; first manual bind → mark risk.
      ...(deal.groupCreatedVia
        ? {}
        : { groupCreatedVia: "manual" as const }),
      ...(groupPhotoSetAt && groupPhotoSetAt !== deal.groupPhotoSetAt
        ? { groupPhotoSetAt }
        : {}),
    }) ?? deal;

  // Se un altro record aveva ancora il vecchio id (race migrate handler), allinea.
  if (liveId !== chatId) {
    remapDealGroupChatId(store, chatId, liveId);
    updated = store.get(deal.id) ?? updated;
  }

  updated = await clearAwaitingGroupDmHints(api, store, updated);

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

/**
 * Aggiorna titolo gruppo con importo (best-effort).
 * Dopo setChatTitle Telegram può migrare group→supergroup: sync `groupChatId`.
 */
export async function refreshGroupTitle(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  if (deal.groupChatId == null) return deal;
  const fromId = deal.groupChatId;
  try {
    await api.setChatTitle(fromId, it.groupTitle(deal));
  } catch (err) {
    const toId = extractMigrateToChatId(err);
    if (toId != null) {
      return syncDealLiveChatId(api, store, deal, toId);
    }
    // ok se manca can_change_info
  }
  return syncDealLiveChatId(api, store, deal);
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

/**
 * Lock in-process: coalescia chiamate concorrenti (watcher + Verifica / Stato)
 * sullo stesso deal così non partono due sendMessage «consegna».
 */
const deliveryCtaInFlight = new Map<string, Promise<Deal>>();

function withDeliveryCtaLock(
  dealId: string,
  run: () => Promise<Deal>,
): Promise<Deal> {
  const existing = deliveryCtaInFlight.get(dealId);
  if (existing) return existing;
  const promise = run().finally(() => {
    if (deliveryCtaInFlight.get(dealId) === promise) {
      deliveryCtaInFlight.delete(dealId);
    }
  });
  deliveryCtaInFlight.set(dealId, promise);
  return promise;
}

function hasTrackedStagePrompt(deal: Deal): boolean {
  return (deal.botPromptIds?.length ?? 0) > 0;
}

/**
 * Dopo deposito confermato: aggiorna la card pinnata (*DEPOSITO CONFERMATO*),
 * chiude UI deposito (prompt + effimeri + errori ruolo) e chiede al seller di consegnare.
 * Usato da watcher e Verifica deposito.
 * Idempotente: una sola card «Consegnato» anche con race watcher/Verifica.
 */
export async function postShipAsk(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return withDeliveryCtaLock(deal.id, async () => {
    let current = store.get(deal.id) ?? deal;
    if (current.sellerShippedAt) {
      return postBuyerAfterShipUnlocked(api, store, current);
    }

    // Già posta e ancora in chat → non ripostare (niente doppione).
    if (current.deliveryCta === "ship_ask" && hasTrackedStagePrompt(current)) {
      try {
        current = await refreshGroupSetupCard(api, store, current);
      } catch (err) {
        console.warn(
          `postShipAsk refresh (idempotent) #${current.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
      return store.get(current.id) ?? current;
    }

    current = await clearEphemeralReplies(api, store, current);
    current = await clearRoleError(api, store, current);
    // Pin / card vivente: stato funded senza shouty separate.
    try {
      current = await refreshGroupSetupCard(api, store, current);
    } catch (err) {
      console.warn(
        `postShipAsk refresh card #${current.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
    if (current.sellerShippedAt) {
      return postBuyerAfterShipUnlocked(api, store, current);
    }

    // Claim prima del send: un secondo path che entra dopo il lock vede deliveryCta.
    current =
      store.update(current.id, { deliveryCta: "ship_ask" }) ?? current;

    // sendTrackedPrompt cancella i prompt stage (card Verifica deposito / Indirizzo).
    return sendTrackedPrompt(api, store, current, it.shipAsk(current), {
      parse_mode: "Markdown",
      reply_markup: shipAskKeyboard(),
    });
  });
}

/** Seller ha consegnato: CTA buyer (paga / info / disputa). Idempotente. */
export async function postBuyerAfterShip(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  return withDeliveryCtaLock(deal.id, () =>
    postBuyerAfterShipUnlocked(api, store, deal),
  );
}

async function postBuyerAfterShipUnlocked(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  let current = store.get(deal.id) ?? deal;
  if (
    current.deliveryCta === "buyer_after_ship" &&
    hasTrackedStagePrompt(current)
  ) {
    return current;
  }
  current = await clearRoleError(api, store, current);
  current =
    store.update(current.id, { deliveryCta: "buyer_after_ship" }) ?? current;
  return sendTrackedPrompt(api, store, current, it.buyerAfterShip(current), {
    parse_mode: "Markdown",
    reply_markup: buyerAfterShipKeyboard(current),
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
 * Testo italiano da mostrare dopo /avvia se l'auto-bind non chiude i ruoli.
 * `too_many` → troppi membri; altrimenti invite buyer/seller (helper) o entra/scrivi.
 * Pure: usata da handler + smoke check.
 */
export function avviaAutoBindReply(
  reason: AutoBindFailure,
  deal: Pick<
    Deal,
    | "id"
    | "creatorRole"
    | "groupCreatedVia"
    | "counterpartInviteLink"
    | "pendingCounterpartUserId"
    | "pendingCounterpartUsername"
    | "pendingCounterpartDisplayName"
  >,
): string {
  if (reason === "too_many") return it.autoBindTooMany;
  if (reason === "need_confirm") {
    const role: "buyer" | "seller" =
      deal.creatorRole === "buyer" ? "seller" : "buyer";
    const pendingId = deal.pendingCounterpartUserId;
    const who = deal.pendingCounterpartUsername
      ? `@${deal.pendingCounterpartUsername}`
      : deal.pendingCounterpartDisplayName?.trim() ||
        (pendingId != null ? `id ${pendingId}` : "candidato");
    return it.counterpartConfirmAsk({ dealId: deal.id, who, role });
  }
  return it.avviaAwaitingCounterpart(deal);
}

/**
 * Evita doppio stack dopo /avvia: i due messaggi invite (helper) o la
 * living card (manuale) sono già il prompt.
 *
 * - `too_many` → sempre inviare
 * - prompt presente (setupMessageId *oppure* entrambi i msg invite) → skip
 * - prompt assente → un solo status (niente silenzio)
 *
 * `afterPromptMessageId` = setupMessageId *oppure* link-msg id dopo start.
 */
export function shouldSendAvviaAutoBindStatus(
  reason: AutoBindFailure,
  _priorSetupMessageId: number | undefined,
  afterPromptMessageId: number | undefined,
): boolean {
  if (reason === "too_many" || reason === "need_confirm") return true;
  if (afterPromptMessageId != null) return false;
  return true;
}

/** Id da passare a shouldSendAvviaAutoBindStatus dopo startDealInGroup. */
export function avviaPromptMessageId(deal: Deal): number | undefined {
  if (hasCounterpartInviteMessages(deal)) {
    return deal.counterpartInviteLinkMessageId;
  }
  return deal.setupMessageId;
}

/**
 * Dopo ruoli bound: se termini pronti → Accetta/Proponi;
 * altrimenti riprende wizard DM sul proponente (opener di default).
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
    if (current.tosProposedBy == null) {
      current =
        store.update(current.id, {
          tosProposedBy: current.creatorId,
        }) ?? current;
    }
    current =
      store.setStatus(current.id, "awaiting_tos_confirm") ?? current;
    return refreshGroupSetupCard(api, store, current);
  }

  current = store.setStatus(current.id, "awaiting_tos") ?? current;
  if (current.tosProposedBy == null) {
    current =
      store.update(current.id, { tosProposedBy: current.creatorId }) ??
      current;
  }
  current = await refreshGroupSetupCard(api, store, current);

  const wizard = await startTermsWizard(
    api,
    store,
    current,
    current.tosProposedBy ?? current.creatorId,
  );
  if (!wizard.ok && wizard.reason === "dm_blocked") {
    await api.sendMessage(
      current.groupChatId!,
      it.dmTermsProposerBlocked(current),
      { parse_mode: "Markdown" },
    );
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
 * poi card Accetta/Proponi (termini già in DM opener) o ripresa wizard.
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
    /**
     * Skip harden+demote (già fatti in createEscrowGroup sul path helper create).
     * /avvia e join lifecycle non passano questo flag.
     */
    skipHarden?: boolean;
  },
): Promise<StartDealResult> {
  const { deal: bound, perms } = await bindGroupToDeal(api, store, deal, chatId);
  if (!perms.ok) {
    return { deal: bound, started: false, perms };
  }

  // Dopo setChatPhoto Telegram può migrare group→supergroup:
  // usa sempre l'id live (bound), non l'id dello update originale.
  const liveChatId = bound.groupChatId ?? chatId;

  // Helper-owned: harden + strip party admin rights (bot cannot be owner).
  if (bound.groupCreatedVia === "helper" && !opts?.skipHarden) {
    await Promise.all([
      hardenGroupPermissions(api, liveChatId),
      demoteNonOwnerHumanAdmins(api, liveChatId),
    ]);
  }

  let current = trackSeenGroupUser(store, bound, bound.creatorId);
  if (opts?.runnerId != null) {
    current = trackSeenGroupUser(store, current, opts.runnerId);
  }

  if (!bothPartiesPresent(current)) {
    const bind = await autoBindCounterpart(
      api,
      store,
      current,
      liveChatId,
      opts,
    );
    if (!bind.ok) {
      let waiting =
        store.setStatus(bind.deal.id, "awaiting_counterpart") ?? bind.deal;
      // Deve propagare setupMessageId: altrimenti /avvia non vede la card
      // e reinviava un secondo «entra o scrivi» (status reply).
      try {
        waiting = await refreshGroupSetupCard(api, store, waiting);
      } catch {
        waiting = store.get(waiting.id) ?? waiting;
      }
      if (bind.reason === "need_confirm") {
        waiting = await ensureCounterpartConfirmPrompt(api, store, waiting);
      }
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
