import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import type { Deal } from "../types.js";
import {
  amountConfirmed,
  assignJoiningParty,
  bothPartiesPresent,
  canBindAsDealParty,
  isAdminUser,
  isAllowedHuman,
  isParty,
  isPreDepositSetup,
  isSupportHelperUser,
  isTermsProposer,
  nextDmTermsStep,
  parseAmount,
  parseStartGroupPayload,
  termsReadyForConfirm,
  tosAccepted,
} from "../services/deal-logic.js";
import { markGroupCompromised } from "../services/group-compromise.js";
import {
  applyGroupTermsAnswer,
  startProposeTermsWizard,
} from "../services/dm-terms.js";
import { convertPriceEurToSol } from "../services/fx/sol-eur.js";
import {
  demoteIfPartyPromoted,
  hardenGroupPermissions,
} from "../services/group-creator.js";
import { groupBindExpiresAtIso } from "../services/group-bind-expiry.js";
import {
  findDealForGroupChat,
  healMigratedGroupDeal,
  remapDealGroupChatId,
  syncDealLiveChatId,
} from "../services/group-chat-remap.js";
import {
  autoBindCounterpart,
  avviaAutoBindReply,
  checkRequiredBotAdminPerms,
  clearAwaitingGroupDmHints,
  kickUnauthorized,
  postAskSellerWallet,
  refreshGroupSetupCard,
  refreshGroupTitle,
  avviaPromptMessageId,
  shouldSendAvviaAutoBindStatus,
  startDealInGroup,
  trackSeenGroupUser,
  type AutoBindFailure,
  type BotAdminCheck,
} from "../services/group-setup.js";
import {
  clearBotPrompts,
  clearEphemeralReplies,
  clearRoleError,
  deleteMessageSafe,
  replaceRoleError,
  sendTrackedPrompt,
} from "../services/prompt-cleanup.js";
import { acceptDealTerms } from "../services/tos-accept.js";
import { kickUnauthorizedBot } from "./group-hygiene.js";

function displayNameOf(user: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/** Testo alert callback (max 200, senza Markdown). */
function plainAlert(text: string): string {
  return text
    .replace(/[*_`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function adminPermsMessage(perms: Extract<BotAdminCheck, { ok: false }>): string {
  return it.missingBotPerms(perms.missing, { notAdmin: perms.notAdmin });
}

function autoBindReply(
  reason: AutoBindFailure,
  deal: { id: string; creatorRole: "buyer" | "seller" },
): string {
  return avviaAutoBindReply(reason, deal);
}

/** Buyer/seller/creator del deal (o slot ancora aperto per la controparte). */
function canRunAvvia(
  deal: { creatorId: number; buyerId?: number; sellerId?: number },
  userId: number,
): boolean {
  if (deal.creatorId === userId) return true;
  if (deal.buyerId === userId || deal.sellerId === userId) return true;
  // Helper/support owner: osserva, non fa da controparte.
  if (isSupportHelperUser(userId)) return false;
  // Controparte non ancora bound: buyer o seller slot libero → chiunque
  // (non-helper) nel gruppo col deal collegato può /avvia (auto-bind).
  const missingBuyer = deal.buyerId == null;
  const missingSeller = deal.sellerId == null;
  return missingBuyer || missingSeller;
}

type AvviaRunner = {
  runnerId: number;
  runnerUsername?: string;
  runnerDisplayName?: string;
};

/**
 * Dopo promozione admin (o bot già admin al join): riprendi startDealInGroup
 * senza chiedere un secondo /avvia. Cancella hint permessi.
 */
async function resumeAvviaAfterAdmin(
  ctx: BotContext,
  deal: Parameters<typeof startDealInGroup>[2],
  chatId: number,
  runner: AvviaRunner,
): Promise<void> {
  const priorPromptId = avviaPromptMessageId(deal);
  const { deal: started, perms, autoBind } = await startDealInGroup(
    ctx.api,
    ctx.store,
    deal,
    chatId,
    runner,
  );

  if (!perms.ok) {
    await sendTrackedPrompt(
      ctx.api,
      ctx.store,
      started,
      adminPermsMessage(perms),
      { parse_mode: "Markdown" },
    );
    return;
  }

  if (autoBind) {
    // Due msg invite (helper) o card (manuale) = prompt unico; status solo se manca / too_many.
    if (
      shouldSendAvviaAutoBindStatus(
        autoBind,
        priorPromptId,
        avviaPromptMessageId(started),
      )
    ) {
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        started,
        autoBindReply(autoBind, started),
        { parse_mode: "Markdown" },
      );
    } else {
      // Togli eventuali status «già avviato» residui; lascia solo la card.
      await clearBotPrompts(ctx.api, ctx.store, started);
    }
    return;
  }

  await clearBotPrompts(ctx.api, ctx.store, started);
}

async function onHumanJoined(
  ctx: BotContext,
  chatId: number,
  userId: number,
  username: string | undefined,
  displayName?: string,
): Promise<void> {
  const deal = await findDealForGroupChat(ctx.api, ctx.store, chatId, userId);
  if (!deal) return;

  let current = trackSeenGroupUser(ctx.store, deal, userId);

  if (!bothPartiesPresent(current)) {
    // Già buyer/seller/creator: solo refresh username/display.
    if (isParty(current, userId) || userId === current.creatorId) {
      const patch = assignJoiningParty(current, userId, username, displayName);
      if (patch) {
        current = ctx.store.update(current.id, patch) ?? current;
      }
      return;
    }
    // Helper/support (owner gruppo): resta, mai bind come controparte.
    if (isSupportHelperUser(userId)) {
      return;
    }
    if (current.buyerId == null || current.sellerId == null) {
      // Nuovo umano (invite-link): prova bind immediato.
      const bind = await autoBindCounterpart(
        ctx.api,
        ctx.store,
        current,
        chatId,
        {
          runnerId: userId,
          runnerUsername: username,
          runnerDisplayName: displayName,
        },
      );
      current = bind.deal;
      if (
        bind.ok &&
        bothPartiesPresent(current) &&
        (current.status === "awaiting_counterpart" ||
          current.status === "awaiting_bot_admin")
      ) {
        const { deal: advanced } = await startDealInGroup(
          ctx.api,
          ctx.store,
          current,
          chatId,
          {
            runnerId: userId,
            runnerUsername: username,
            runnerDisplayName: displayName,
          },
        );
        await clearBotPrompts(ctx.api, ctx.store, advanced);
      }
    }
    return;
  }

  if (isAllowedHuman(current, userId)) {
    // Parti: refresh meta. Admin/helper: restano senza bind.
    if (canBindAsDealParty(current, userId)) {
      const patch = assignJoiningParty(current, userId, username, displayName);
      if (patch) ctx.store.update(current.id, patch);
    }
    return;
  }

  await kickUnauthorized(ctx.api, chatId, userId);
}

/**
 * Se `groupChatId` è stale dopo migrazione group→supergroup, heal/sync.
 * `null` = deal davvero legato a un altro gruppo.
 */
async function dealInThisChat(
  ctx: BotContext,
  deal: Deal,
): Promise<Deal | null> {
  if (!ctx.chat) return null;
  if (deal.groupChatId == null || deal.groupChatId === ctx.chat.id) {
    return deal;
  }
  const healed = await healMigratedGroupDeal(
    ctx.api,
    ctx.store,
    ctx.chat.id,
    ctx.from?.id,
  );
  if (healed?.id === deal.id) return healed;

  const fresh = ctx.store.get(deal.id) ?? deal;
  const synced = await syncDealLiveChatId(ctx.api, ctx.store, fresh);
  if (synced.groupChatId === ctx.chat.id) return synced;
  return null;
}

export function registerGroupLifecycleHandlers(bot: Bot<BotContext>): void {
  /**
   * Basic group → supergroup: Telegram cambia chat id.
   * Senza remap, findByGroupChatId fallisce (card ancora visibile, /wallet no deal).
   */
  bot.on("message:migrate_to_chat_id", async (ctx) => {
    const oldId = ctx.chat?.id;
    const newId = ctx.message.migrate_to_chat_id;
    if (oldId == null || newId == null) return;
    remapDealGroupChatId(ctx.store, oldId, newId);
  });

  bot.on("message:migrate_from_chat_id", async (ctx) => {
    const newId = ctx.chat?.id;
    const oldId = ctx.message.migrate_from_chat_id;
    if (oldId == null || newId == null) return;
    remapDealGroupChatId(ctx.store, oldId, newId);
  });

  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const update = ctx.myChatMember;
    const status = update.new_chat_member.status;

    // Bot kickato / uscito / gruppo cancellato → DM admin + freeze.
    if (status === "left" || status === "kicked") {
      const deal = ctx.store.findByGroupChatId(chat.id);
      if (deal) {
        await markGroupCompromised(ctx.api, ctx.store, deal, "bot_kicked");
      }
      return;
    }

    const joined =
      status === "member" || status === "administrator" || status === "restricted";
    if (!joined) return;

    const runner = {
      runnerId: update.from.id,
      runnerUsername: update.from.username,
      runnerDisplayName: displayNameOf(update.from),
    };

    const already = ctx.store.findByGroupChatId(chat.id);
    if (already) {
      if (status === "administrator") {
        await hardenGroupPermissions(ctx.api, chat.id);
        const perms = await checkRequiredBotAdminPerms(ctx.api, chat.id);
        if (!perms.ok) {
          // Admin ma senza flag obbligatori: una sola notifica (replace).
          if (!perms.notAdmin) {
            await sendTrackedPrompt(
              ctx.api,
              ctx.store,
              already,
              adminPermsMessage(perms),
              { parse_mode: "Markdown" },
            );
          }
        } else {
          // Permessi ok: togli hint «need admin» e riprendi /avvia se in attesa.
          let current = ctx.store.get(already.id) ?? already;
          current = await clearBotPrompts(ctx.api, ctx.store, current);
          if (
            current.status === "awaiting_bot_admin" ||
            current.status === "awaiting_group" ||
            current.status === "awaiting_counterpart"
          ) {
            await resumeAvviaAfterAdmin(ctx, current, chat.id, runner);
          }
        }
      }
      console.log(`Bot in chat ${chat.id} (deal #${already.id} già collegato)`);
      return;
    }

    // Path felice: bot aggiunto a gruppo — collega deal di creator o party.
    // Passa chat.id: non rubare un deal già bound a un altro gruppo (multi-deal).
    const pending =
      ctx.store.findAwaitingGroupByCreator(update.from.id, chat.id) ??
      ctx.store.findAwaitingGroupByParty(update.from.id, chat.id);
    if (pending && pending.groupChatId == null) {
      // Non azzerare TTL: se non arriva /avvia entro 10 min → auto-cancel.
      // clearAwaitingGroupDmHints toglie istruzioni/termini DM ma azzera anche
      // awaitingGroupExpiresAt — ripristiniamo il TTL sotto.
      const expiresAt =
        pending.awaitingGroupExpiresAt ?? groupBindExpiresAtIso();
      let linked =
        ctx.store.update(pending.id, {
          groupChatId: chat.id,
          status: "awaiting_bot_admin",
          awaitingGroupExpiresAt: expiresAt,
        }) ?? pending;
      linked = await clearAwaitingGroupDmHints(ctx.api, ctx.store, linked);
      linked =
        ctx.store.update(linked.id, {
          awaitingGroupExpiresAt: expiresAt,
        }) ?? linked;
      trackSeenGroupUser(ctx.store, linked, update.from.id);
    }

    const bound = ctx.store.findByGroupChatId(chat.id);
    // Già admin con permessi: riprendi subito (niente doppio /avvia).
    if (bound && status === "administrator") {
      await hardenGroupPermissions(ctx.api, chat.id);
      const perms = await checkRequiredBotAdminPerms(ctx.api, chat.id);
      if (perms.ok) {
        const current = ctx.store.get(bound.id) ?? bound;
        await resumeAvviaAfterAdmin(ctx, current, chat.id, runner);
        console.log(`Bot admin in chat ${chat.id}; /avvia ripreso auto`);
        return;
      }
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        bound,
        adminPermsMessage(perms),
        { parse_mode: "Markdown" },
      );
      console.log(`Bot in chat ${chat.id}; permessi admin incompleti`);
      return;
    }

    await ctx.api.sendMessage(chat.id, it.botAddedHint, {
      parse_mode: "Markdown",
    });
    console.log(`Bot aggiunto a chat ${chat.id}; in attesa di /avvia`);
  });

  /**
   * /avvia — collega il gruppo, auto-assegna la controparte, card Accetta/Proponi.
   * Buyer o seller (non solo il creator DM). Alias: /setup.
   */
  const avvia = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      return;
    }
    if (!ctx.from) return;
    // /avvia: niente gate soft signup. L'opener è già iscritto via /crea;
    // la controparte può /avvia / scrivere senza /start + @.

    try {
      const existing = await findDealForGroupChat(
        ctx.api,
        ctx.store,
        ctx.chat.id,
        ctx.from.id,
      );
      // Già collegato oltre bind/auto-bind: niente seconda card completa.
      // awaiting_counterpart: permetti retry dopo invite.
      if (
        existing &&
        existing.status !== "awaiting_bot_admin" &&
        existing.status !== "awaiting_group" &&
        existing.status !== "awaiting_counterpart"
      ) {
        if (ctx.message?.message_id != null) {
          await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        }
        await replaceRoleError(
          ctx.api,
          ctx.store,
          existing,
          it.alreadyLinkedShort(existing),
          { parse_mode: "Markdown" },
        );
        return;
      }

      let deal = existing;
      if (!deal) {
        // Esclude deal già bound ad altri gruppi (stesso amico / multi-deal OK).
        deal =
          ctx.store.findAwaitingGroupByCreator(ctx.from.id, ctx.chat.id) ??
          ctx.store.findAwaitingGroupByParty(ctx.from.id, ctx.chat.id);
      }

      if (!deal) {
        if (ctx.message?.message_id != null) {
          await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        }
        await ctx.reply(it.noDealInGroup);
        return;
      }

      if (!canRunAvvia(deal, ctx.from.id)) {
        if (ctx.message?.message_id != null) {
          await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        }
        await replaceRoleError(ctx.api, ctx.store, deal, it.notDealParty, {
          parse_mode: "Markdown",
        });
        return;
      }

      {
        const boundHere = await dealInThisChat(ctx, deal);
        if (!boundHere) {
          await ctx.reply(it.alreadyBoundElsewhere(deal), {
            parse_mode: "Markdown",
          });
          return;
        }
        deal = boundHere;
      }

      await hardenGroupPermissions(ctx.api, ctx.chat.id);

      const runner = {
        runnerId: ctx.from.id,
        runnerUsername: ctx.from.username,
        runnerDisplayName: displayNameOf(ctx.from),
      };

      // Prima di startDealInGroup: se i prompt invite non ci sono ancora,
      // il refresh in auto-bind miss è il prompt unico — non stackare status.
      const priorPromptId = avviaPromptMessageId(deal);

      const { deal: started, perms, autoBind } = await startDealInGroup(
        ctx.api,
        ctx.store,
        deal,
        ctx.chat.id,
        runner,
      );

      if (!perms.ok) {
        // Hint cancellabile (igiene Q→A); Accetto/card vivente non toccati.
        await sendTrackedPrompt(
          ctx.api,
          ctx.store,
          started,
          adminPermsMessage(perms),
          { parse_mode: "Markdown" },
        );
        return;
      }

      if (autoBind) {
        // Due msg invite / card = unico identify. Status solo se assente o too_many.
        if (
          shouldSendAvviaAutoBindStatus(
            autoBind,
            priorPromptId,
            avviaPromptMessageId(started),
          )
        ) {
          await sendTrackedPrompt(
            ctx.api,
            ctx.store,
            started,
            autoBindReply(autoBind, started),
            { parse_mode: "Markdown" },
          );
        } else {
          // Ripetuto / resume: niente secondo «entra o scrivi».
          await clearBotPrompts(ctx.api, ctx.store, started);
        }
        return;
      }

      // Deal ok: cancella hint di setup (admin / scrivi messaggio), non la card.
      await clearBotPrompts(ctx.api, ctx.store, started);

      if (
        bothPartiesPresent(started) &&
        started.status !== "awaiting_counterpart" &&
        !isPreDepositSetup(started.status) &&
        tosAccepted(started) &&
        amountConfirmed(started)
      ) {
        await ctx.reply(it.alreadyActivated);
      }
    } catch (err) {
      console.error(
        `/avvia failed in chat ${ctx.chat.id}:`,
        err instanceof Error ? err.message : err,
      );
      try {
        await ctx.reply(
          "Non sono riuscito a completare /avvia. Riprova tra poco o verifica che il bot sia ancora admin.",
        );
      } catch {
        // chat morta / bot kickato
      }
    }
  };

  bot.command("avvia", avvia);
  bot.command("setup", avvia);

  // Legacy: vecchi pulsanti «Confermo» ruolo — reindirizza ad auto-bind
  bot.callbackQuery(/^cp:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    let deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.answerCallbackQuery({ text: "Solo in gruppo" });
      return;
    }
    {
      const boundHere = await dealInThisChat(ctx, deal);
      if (!boundHere) {
        await ctx.answerCallbackQuery({ text: "Gruppo sbagliato" });
        return;
      }
      deal = boundHere;
    }

    const perms = await checkRequiredBotAdminPerms(ctx.api, ctx.chat.id);
    if (!perms.ok) {
      await ctx.answerCallbackQuery({ text: "Permessi bot mancanti" });
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        deal,
        adminPermsMessage(perms),
        { parse_mode: "Markdown" },
      );
      return;
    }

    let current = trackSeenGroupUser(ctx.store, deal, ctx.from.id);
    if (bothPartiesPresent(current)) {
      await ctx.answerCallbackQuery({ text: "Già assegnati" });
      if (!tosAccepted(current) && current.status === "awaiting_counterpart") {
        const { deal: advanced } = await startDealInGroup(
          ctx.api,
          ctx.store,
          current,
          ctx.chat.id,
          {
            runnerId: ctx.from.id,
            runnerUsername: ctx.from.username,
            runnerDisplayName: displayNameOf(ctx.from),
          },
        );
        await clearBotPrompts(ctx.api, ctx.store, advanced);
      }
      return;
    }

    const bind = await autoBindCounterpart(
      ctx.api,
      ctx.store,
      current,
      ctx.chat.id,
      {
        runnerId: ctx.from.id,
        runnerUsername: ctx.from.username,
        runnerDisplayName: displayNameOf(ctx.from),
      },
    );
    if (!bind.ok) {
      await ctx.answerCallbackQuery({ text: "Auto-bind fallito" });
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        bind.deal,
        autoBindReply(bind.reason, bind.deal),
        { parse_mode: "Markdown" },
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: "Ruoli ok" });
    const { deal: advanced } = await startDealInGroup(
      ctx.api,
      ctx.store,
      bind.deal,
      ctx.chat.id,
      {
        runnerId: ctx.from.id,
        runnerUsername: ctx.from.username,
        runnerDisplayName: displayNameOf(ctx.from),
      },
    );
    await clearBotPrompts(ctx.api, ctx.store, advanced);
  });

  // Accetta termini deal (card gruppo) → lock €→SOL → wallet seller
  bot.callbackQuery(/^tosok:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    let deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.answerCallbackQuery({ text: "Solo in gruppo" });
      return;
    }
    {
      const boundHere = await dealInThisChat(ctx, deal);
      if (!boundHere) {
        await ctx.answerCallbackQuery({ text: "Gruppo sbagliato" });
        return;
      }
      deal = boundHere;
    }

    const result = await acceptDealTerms(ctx.api, ctx.store, deal, ctx.from.id, {
      pinMessageId:
        ctx.callbackQuery.message?.message_id ?? deal.setupMessageId,
    });
    if (!result.ok) {
      const alerts: Record<string, string> = {
        not_ready: "Nessun termine da accettare",
        already: plainAlert(it.tosAlreadyAccepted),
        not_party: "Solo buyer/seller del deal.",
        proposer: "Sei il proponente: aspetta l'altra parte.",
        missing_price: plainAlert(it.missingCommercialPrice),
        rate_unavailable: plainAlert(it.rateUnavailable),
        no_group: "Gruppo non collegato",
        not_found: "Deal non trovato",
      };
      await ctx.answerCallbackQuery({
        text: alerts[result.reason] ?? "Impossibile accettare",
        show_alert:
          result.reason === "already" ||
          result.reason === "proposer" ||
          result.reason === "missing_price" ||
          result.reason === "rate_unavailable",
      });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Termini accettati" });
  });

  // Controparte Proponi i ToS → 3 domande nel gruppo → card Accetta/Proponi all'altra parte
  bot.callbackQuery(/^tospropose:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    let deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.answerCallbackQuery({ text: "Solo in gruppo" });
      return;
    }
    {
      const boundHere = await dealInThisChat(ctx, deal);
      if (!boundHere) {
        await ctx.answerCallbackQuery({ text: "Gruppo sbagliato" });
        return;
      }
      deal = boundHere;
    }
    if (tosAccepted(deal)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.tosAlreadyAccepted),
        show_alert: true,
      });
      return;
    }
    if (
      deal.status !== "awaiting_tos_confirm" &&
      deal.status !== "awaiting_tos"
    ) {
      await ctx.answerCallbackQuery({ text: "Non in fase termini" });
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: "Solo buyer/seller del deal.",
        show_alert: true,
      });
      return;
    }
    if (isTermsProposer(deal, ctx.from.id) && termsReadyForConfirm(deal)) {
      await ctx.answerCallbackQuery({
        text: "Sei il proponente: aspetta l'altra parte.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Nuova proposta" });
    let updated = await clearEphemeralReplies(ctx.api, ctx.store, deal);
    const wizard = await startProposeTermsWizard(
      ctx.api,
      ctx.store,
      updated,
      ctx.from.id,
    );
    updated = wizard.deal;
    updated =
      ctx.store.setStatus(updated.id, "awaiting_tos") ?? updated;
    // Card vuota + domande nel gruppo (niente «ti ho scritto in privato»).
    await refreshGroupSetupCard(ctx.api, ctx.store, updated);
  });

  // Legacy dual-confirm importo (deal mid-flight pre-unificazione)
  bot.callbackQuery(/^amtok:(.+)$/, async (ctx) => {
    const dealId = ctx.match![1];
    let deal = ctx.store.get(dealId);
    if (!deal || !ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery({ text: "Deal non trovato" });
      return;
    }
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.answerCallbackQuery({ text: "Solo in gruppo" });
      return;
    }
    {
      const boundHere = await dealInThisChat(ctx, deal);
      if (!boundHere) {
        await ctx.answerCallbackQuery({ text: "Gruppo sbagliato" });
        return;
      }
      deal = boundHere;
    }
    if (!deal.amount || deal.status !== "awaiting_amount_confirm") {
      await ctx.answerCallbackQuery({ text: "Flusso aggiornato: usa i termini" });
      return;
    }
    if (amountConfirmed(deal)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.amountAlreadyConfirmed),
        show_alert: true,
      });
      return;
    }
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: "Solo buyer/seller del deal.",
        show_alert: true,
      });
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
    updated = await refreshGroupTitle(ctx.api, ctx.store, updated);
    updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
    await postAskSellerWallet(ctx.api, ctx.store, updated);
  });

  // Gruppo: niente free-form termini. Legacy importo solo mid-flight.
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
        let deal = ctx.store.get(dealId);
        if (!deal) {
          await next();
          return;
        }

        {
          const boundHere = await dealInThisChat(ctx, deal);
          if (!boundHere) {
            await ctx.reply(it.alreadyBoundElsewhere(deal), {
              parse_mode: "Markdown",
            });
            return;
          }
          deal = boundHere;
        }

        if (
          canRunAvvia(deal, ctx.from.id) &&
          deal.groupChatId == null
        ) {
          const expiresAt =
            deal.awaitingGroupExpiresAt ?? groupBindExpiresAtIso();
          let linked =
            ctx.store.update(deal.id, {
              groupChatId: ctx.chat.id,
              status: "awaiting_bot_admin",
              awaitingGroupExpiresAt: expiresAt,
            }) ?? deal;
          linked = await clearAwaitingGroupDmHints(ctx.api, ctx.store, linked);
          ctx.store.update(linked.id, {
            awaitingGroupExpiresAt: expiresAt,
          });
        }

        trackSeenGroupUser(
          ctx.store,
          ctx.store.get(dealId) ?? deal,
          ctx.from.id,
        );
        await ctx.reply(it.botAddedHint, { parse_mode: "Markdown" });
        return;
      }
    }

    if (text.startsWith("/")) {
      await next();
      return;
    }

    const deal = await findDealForGroupChat(
      ctx.api,
      ctx.store,
      ctx.chat.id,
      ctx.from?.id,
    );
    if (!deal || !ctx.from) {
      await next();
      return;
    }

    let current = trackSeenGroupUser(ctx.store, deal, ctx.from.id);

    // Se ancora in attesa controparte: un messaggio può completare il bind
    // (helper/support escluso — non è una parte invite-link).
    if (
      !bothPartiesPresent(current) &&
      current.status === "awaiting_counterpart" &&
      canBindAsDealParty(current, ctx.from.id)
    ) {
      const bind = await autoBindCounterpart(
        ctx.api,
        ctx.store,
        current,
        ctx.chat.id,
        {
          runnerId: ctx.from.id,
          runnerUsername: ctx.from.username,
          runnerDisplayName: displayNameOf(ctx.from),
        },
      );
      if (bind.ok) {
        // Risposta alla ask «scrivi un messaggio»: cancella hint + risposta, aggiorna card.
        await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        const { deal: advanced } = await startDealInGroup(
          ctx.api,
          ctx.store,
          bind.deal,
          ctx.chat.id,
          {
            runnerId: ctx.from.id,
            runnerUsername: ctx.from.username,
            runnerDisplayName: displayNameOf(ctx.from),
          },
        );
        await clearBotPrompts(ctx.api, ctx.store, advanced);
        return;
      }
      current = bind.deal;
    }

    // Legacy mid-flight: importo dual-confirm (pre conversione €→SOL)
    if (
      current.status === "awaiting_amount" ||
      current.status === "awaiting_amount_confirm"
    ) {
      if (!isParty(current, ctx.from.id)) {
        await next();
        return;
      }
      // Se abbiamo priceEur e ToS accettati, ripara convertendo invece di chiedere SOL.
      // Mai sovrascrivere un target già lockato (amountConfirmed).
      if (
        current.status === "awaiting_amount" &&
        tosAccepted(current) &&
        current.priceEur &&
        !amountConfirmed(current) &&
        !current.amount
      ) {
        const converted = await convertPriceEurToSol(current.priceEur);
        if (!converted) {
          await ctx.reply(it.rateUnavailable, { parse_mode: "Markdown" });
          return;
        }
        let updated = ctx.store.update(current.id, {
          amount: converted,
          amountConfirmedAt: new Date().toISOString(),
          status: "awaiting_seller_wallet",
        })!;
        await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        updated = await refreshGroupTitle(ctx.api, ctx.store, updated);
        updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
        await postAskSellerWallet(ctx.api, ctx.store, updated);
        return;
      }

      // Target già lockato: non accettare nuovo importo manuale / FX.
      if (amountConfirmed(current)) {
        await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        await ctx.reply(it.amountLocked(current), { parse_mode: "Markdown" });
        return;
      }

      const amount = parseAmount(text);
      if (!amount) {
        if (current.status === "awaiting_amount") {
          await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
          await replaceRoleError(
            ctx.api,
            ctx.store,
            current,
            it.invalidAmount,
            { parse_mode: "Markdown" },
          );
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

    // Termini: Proponi → Q&A nel gruppo; opener incompleto resta in DM
    if (
      current.status === "awaiting_tos" ||
      current.status === "awaiting_tos_confirm"
    ) {
      if (tosAccepted(current)) {
        await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        await replaceRoleError(ctx.api, ctx.store, current, it.tosLocked, {
          parse_mode: "Markdown",
        });
        return;
      }

      // Wizard gruppo attivo (Proponi i ToS / nuovo round)
      if (
        current.termsWizardInGroup &&
        current.status === "awaiting_tos" &&
        !termsReadyForConfirm(current)
      ) {
        const step = nextDmTermsStep(current);
        if (!step) {
          await next();
          return;
        }
        if (!isTermsProposer(current, ctx.from.id)) {
          await deleteMessageSafe(
            ctx.api,
            ctx.chat.id,
            ctx.message.message_id,
          );
          await replaceRoleError(
            ctx.api,
            ctx.store,
            current,
            it.termsOnlyProposer(current),
            { parse_mode: "Markdown" },
          );
          return;
        }

        const result = await applyGroupTermsAnswer(
          ctx.api,
          ctx.store,
          current,
          ctx.from.id,
          step,
          text,
          ctx.message.message_id,
        );

        if (!result.ok) {
          await deleteMessageSafe(
            ctx.api,
            ctx.chat.id,
            ctx.message.message_id,
          );
          if (result.reason === "wrong_user") {
            await replaceRoleError(
              ctx.api,
              ctx.store,
              result.deal,
              it.termsOnlyProposer(result.deal),
              { parse_mode: "Markdown" },
            );
            return;
          }
          // Risposta invalida: prompt resta; errore corto
          const errText =
            result.reason === "price"
              ? it.dmTermsInvalidPrice
              : it.dmTermsTooShort;
          await replaceRoleError(ctx.api, ctx.store, result.deal, errText, {
            parse_mode: "Markdown",
          });
          return;
        }

        let updated = result.deal;
        if (result.done) {
          await clearRoleError(ctx.api, ctx.store, updated);
          updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
          return;
        }
        await clearRoleError(ctx.api, ctx.store, updated);
        updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
        return;
      }

      // Termini pronti: usa i bottoni, non testo libero
      if (
        current.status === "awaiting_tos_confirm" &&
        termsReadyForConfirm(current)
      ) {
        await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        const notice = await ctx.reply(it.termsUseButtons, {
          parse_mode: "Markdown",
        });
        setTimeout(() => {
          void deleteMessageSafe(ctx.api, ctx.chat!.id, notice.message_id);
        }, 8_000);
        return;
      }

      // Opener ancora in DM
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
      const notice = await ctx.reply(it.termsOnlyInDm(current), {
        parse_mode: "Markdown",
      });
      setTimeout(() => {
        void deleteMessageSafe(ctx.api, ctx.chat!.id, notice.message_id);
      }, 8_000);
      return;
    }

    await next();
  });

  bot.on("chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const member = ctx.chatMember.new_chat_member;
    const user = member.user;
    const oldStatus = ctx.chatMember.old_chat_member.status;

    // Admin supporto kickato / uscito dal gruppo deal → stesso alert + freeze.
    const leftOrKicked =
      member.status === "left" || member.status === "kicked";
    if (
      leftOrKicked &&
      !user.is_bot &&
      isAdminUser(user.id) &&
      (oldStatus === "member" ||
        oldStatus === "administrator" ||
        oldStatus === "restricted")
    ) {
      const deal = ctx.store.findByGroupChatId(chat.id);
      if (deal) {
        await markGroupCompromised(ctx.api, ctx.store, deal, "admin_kicked", {
          detail: `admin ${user.id}`,
        });
      }
      return;
    }

    const becameMember =
      member.status === "member" ||
      member.status === "administrator" ||
      member.status === "restricted";
    if (!becameMember) return;

    if (user.is_bot) {
      await kickUnauthorizedBot(ctx, chat.id, user);
      return;
    }

    // Helper-owned groups: parties must stay members (no destructive admin).
    if (member.status === "administrator") {
      const deal = ctx.store.findByGroupChatId(chat.id);
      if (deal?.groupCreatedVia === "helper") {
        const demoted = await demoteIfPartyPromoted(ctx.api, chat.id, user.id);
        if (demoted) {
          await ctx.api
            .sendMessage(
              chat.id,
              it.partyAdminDemoted(
                user.username ? `@${user.username}` : String(user.id),
              ),
              { parse_mode: "Markdown" },
            )
            .catch(() => undefined);
        }
      }
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
