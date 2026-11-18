import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  amountConfirmed,
  assignJoiningParty,
  bothPartiesPresent,
  isAllowedHuman,
  isParty,
  isPreDepositSetup,
  isTermsProposer,
  nextDmTermsStep,
  parseAmount,
  parseStartGroupPayload,
  termsReadyForConfirm,
  tosAccepted,
} from "../services/deal-logic.js";
import {
  applyGroupTermsAnswer,
  startProposeTermsWizard,
} from "../services/dm-terms.js";
import { convertPriceEurToSol } from "../services/fx/sol-eur.js";
import { hardenGroupPermissions } from "../services/group-creator.js";
import {
  autoBindCounterpart,
  checkRequiredBotAdminPerms,
  kickUnauthorized,
  postAskSellerWallet,
  refreshGroupSetupCard,
  refreshGroupTitle,
  startDealInGroup,
  trackSeenGroupUser,
  type BotAdminCheck,
} from "../services/group-setup.js";
import {
  clearBotPrompts,
  clearEphemeralReplies,
  clearRoleError,
  deleteMessageSafe,
  pinAcceptedTos,
  replaceRoleError,
  sendTrackedPrompt,
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

function adminPermsMessage(perms: Extract<BotAdminCheck, { ok: false }>): string {
  return it.missingBotPerms(perms.missing, { notAdmin: perms.notAdmin });
}

function autoBindReply(
  reason: "too_many" | "none" | "need_message",
  deal: Parameters<typeof it.counterpartAsk>[0],
): string {
  if (reason === "too_many") return it.autoBindTooMany;
  // none / need_message: role-aware (la card vivente di solito basta).
  return it.counterpartAsk(deal);
}

/** Buyer/seller/creator del deal (o slot ancora aperto per la controparte). */
function canRunAvvia(
  deal: { creatorId: number; buyerId?: number; sellerId?: number },
  userId: number,
): boolean {
  if (deal.creatorId === userId) return true;
  if (deal.buyerId === userId || deal.sellerId === userId) return true;
  // Controparte non ancora bound: buyer o seller slot libero → chiunque
  // nel gruppo col deal collegato può /avvia (auto-bind userà runnerId).
  const missingBuyer = deal.buyerId == null;
  const missingSeller = deal.sellerId == null;
  return missingBuyer || missingSeller;
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

  if (!bothPartiesPresent(current)) {
    if (isAllowedHuman(current, userId) || userId === current.creatorId) {
      const patch = assignJoiningParty(current, userId, username, displayName);
      if (patch) {
        current = ctx.store.update(current.id, patch) ?? current;
      }
    } else if (
      current.buyerId == null ||
      current.sellerId == null
    ) {
      // Nuovo umano: prova bind immediato (niente attesa messaggio).
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
          // Domanda admin «risposta»: cancella hint, card/deal restano.
          let current = ctx.store.get(already.id) ?? already;
          current = await clearBotPrompts(ctx.api, ctx.store, current);
          void current;
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
      const instructionsId = pending.dmGroupInstructionsMessageId;
      ctx.store.update(pending.id, {
        groupChatId: chat.id,
        status: "awaiting_bot_admin",
        awaitingGroupExpiresAt: undefined,
        dmGroupInstructionsMessageId: undefined,
      });
      if (instructionsId != null) {
        await deleteMessageSafe(ctx.api, pending.creatorId, instructionsId);
      }
      trackSeenGroupUser(
        ctx.store,
        ctx.store.get(pending.id) ?? pending,
        update.from.id,
      );
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

    const existing = ctx.store.findByGroupChatId(ctx.chat.id);
    // Già collegato oltre bind/auto-bind: niente seconda card completa.
    // awaiting_counterpart: permetti retry dopo invite.
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

    let deal = existing;
    if (!deal) {
      // Esclude deal già bound ad altri gruppi (stesso amico / multi-deal OK).
      deal =
        ctx.store.findAwaitingGroupByCreator(ctx.from.id, ctx.chat.id) ??
        ctx.store.findAwaitingGroupByParty(ctx.from.id, ctx.chat.id);
    }

    if (!deal) {
      await ctx.reply(it.noDealInGroup);
      return;
    }

    if (!canRunAvvia(deal, ctx.from.id)) {
      await ctx.reply(it.notDealParty, { parse_mode: "Markdown" });
      return;
    }

    if (deal.groupChatId != null && deal.groupChatId !== ctx.chat.id) {
      await ctx.reply(it.alreadyBoundElsewhere(deal), {
        parse_mode: "Markdown",
      });
      return;
    }

    await hardenGroupPermissions(ctx.api, ctx.chat.id);

    const runner = {
      runnerId: ctx.from.id,
      runnerUsername: ctx.from.username,
      runnerDisplayName: displayNameOf(ctx.from),
    };

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
      // Card vivente già mostra counterpartAsk — niente secondo messaggio uguale.
      // Solo too_many ha copy diversa (gruppo troppo pieno).
      if (autoBind === "too_many") {
        await sendTrackedPrompt(
          ctx.api,
          ctx.store,
          started,
          autoBindReply(autoBind, started),
          { parse_mode: "Markdown" },
        );
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

  // Controparte Accetta termini → lock + pin → converti €→SOL → wallet seller
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
    if (!isParty(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Non sei parte" });
      await ctx.reply(it.notParty);
      return;
    }
    // Chi ha proposto non può accettare la propria card
    if (isTermsProposer(deal, ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "Sei il proponente" });
      await ctx.reply(it.tosProposerCannotAccept, { parse_mode: "Markdown" });
      return;
    }

    const tosMsgId =
      ctx.callbackQuery.message?.message_id ?? deal.setupMessageId;
    const now = new Date().toISOString();

    // SOL target: lock una sola volta. Se già confermato, non ricalcolare FX.
    let solAmount = "";
    if (amountConfirmed(deal) && parseAmount(deal.amount)) {
      solAmount = deal.amount;
    } else if (deal.amount && parseAmount(deal.amount)) {
      // Amount già presente (legacy / retry): locka senza nuova FX.
      solAmount = deal.amount;
    } else {
      if (!deal.priceEur) {
        await ctx.answerCallbackQuery({ text: "Manca Prezzo €" });
        await ctx.reply(it.missingCommercialPrice, { parse_mode: "Markdown" });
        return;
      }
      const converted = await convertPriceEurToSol(deal.priceEur);
      if (!converted) {
        await ctx.answerCallbackQuery({ text: "Tasso non disponibile" });
        await ctx.reply(it.rateUnavailable, { parse_mode: "Markdown" });
        return;
      }
      solAmount = converted;
    }

    let updated = ctx.store.update(deal.id, {
      tosAcceptedAt: now,
      amount: solAmount,
      amountConfirmedAt: deal.amountConfirmedAt ?? now,
      status: "awaiting_seller_wallet" as const,
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
    // Niente reply Accetto leftover: card aggiornata + ask wallet bastano.
    await refreshGroupTitle(ctx.api, updated);
    updated = await refreshGroupSetupCard(ctx.api, ctx.store, updated);
    await postAskSellerWallet(ctx.api, ctx.store, updated);
  });

  // Controparte Proponi i ToS → 3 domande nel gruppo → card Accetta/Proponi all'altra parte
  bot.callbackQuery(/^tospropose:(.+)$/, async (ctx) => {
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
    if (tosAccepted(deal)) {
      await ctx.answerCallbackQuery({ text: "Già accettati" });
      await ctx.reply(it.tosAlreadyAccepted);
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
      await ctx.answerCallbackQuery({ text: "Non sei parte" });
      await ctx.reply(it.notParty);
      return;
    }
    if (isTermsProposer(deal, ctx.from.id) && termsReadyForConfirm(deal)) {
      await ctx.answerCallbackQuery({ text: "Sei il proponente" });
      await ctx.reply(it.tosProposerCannotAccept, { parse_mode: "Markdown" });
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
        const deal = ctx.store.get(dealId);
        if (!deal) {
          await next();
          return;
        }

        if (deal.groupChatId != null && deal.groupChatId !== ctx.chat.id) {
          await ctx.reply(it.alreadyBoundElsewhere(deal), {
            parse_mode: "Markdown",
          });
          return;
        }

        if (
          canRunAvvia(deal, ctx.from.id) &&
          deal.groupChatId == null
        ) {
          const instructionsId = deal.dmGroupInstructionsMessageId;
          ctx.store.update(deal.id, {
            groupChatId: ctx.chat.id,
            status: "awaiting_bot_admin",
            awaitingGroupExpiresAt: undefined,
            dmGroupInstructionsMessageId: undefined,
          });
          if (instructionsId != null) {
            await deleteMessageSafe(ctx.api, deal.creatorId, instructionsId);
          }
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

    const deal = ctx.store.findByGroupChatId(ctx.chat.id);
    if (!deal || !ctx.from) {
      await next();
      return;
    }

    let current = trackSeenGroupUser(ctx.store, deal, ctx.from.id);

    // Se ancora in attesa controparte: un messaggio può completare il bind
    if (
      !bothPartiesPresent(current) &&
      current.status === "awaiting_counterpart"
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
        await refreshGroupTitle(ctx.api, updated);
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

    // Termini: Proponi → Q&A nel gruppo; opener incompleto resta in DM
    if (
      current.status === "awaiting_tos" ||
      current.status === "awaiting_tos_confirm"
    ) {
      if (tosAccepted(current)) {
        await ctx.reply(it.tosLocked);
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
