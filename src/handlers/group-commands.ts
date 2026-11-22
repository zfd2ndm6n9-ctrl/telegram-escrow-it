import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { formatDealStatus, it } from "../messages/it.js";
import {
  altreInfoKeyboard,
  groupActionsKeyboard,
  payoutHashKeyboard,
  refundConfirmKeyboard,
  selfConfirmKeyboard,
  sellerConfirmPayKeyboard,
} from "../keyboards/menus.js";
import {
  addUniqueVote,
  buyerHasReleaseVote,
  canMarkShipped,
  isAdminUser,
  isParty,
  isPreDepositSetup,
  pendingVoterId,
} from "../services/deal-logic.js";
import { scheduleGroupCloseCleanup } from "../services/group-close-cleanup.js";
import {
  createAdminInviteLink,
  postAskBuyerWallet,
  postBuyerAfterShip,
  postDealActivated,
  postShipAsk,
} from "../services/group-setup.js";
import {
  clearBotPrompts,
  clearEphemeralReplies,
  clearRoleError,
  deleteMessageSafe,
  replaceActionReply,
  replaceRoleError,
  replaceStatusMessage,
  sendTrackedPrompt,
} from "../services/prompt-cleanup.js";
import { getOrphanProfile } from "../services/orphan-profiles.js";
import {
  acceptReviewAnswer,
  beginOrContinueReviews,
  expectedReviewer,
  reviewsPending,
} from "../services/reviews.js";
import {
  findDealForGroupChat,
  remapDealGroupChatId,
} from "../services/group-chat-remap.js";
import {
  checkDealDeposit,
  classifyPayoutError,
  deriveDealKeypair,
  getEscrowBalanceLamports,
  getMasterKeypair,
  isValidSolAddress,
  lamportsToSolString,
  looksLikeSolAddressAttempt,
  payoutDealSol,
} from "../services/solana/index.js";
import type { Deal, DealStatus, SelfConfirmKind } from "../types.js";

/**
 * grammY `bot.command("wallet")` confronta il nome in modo case-sensitive
 * (`/Wallet` ≠ `wallet`). Telegram invece tratta i comandi case-insensitive:
 * senza questo parser `/Wallet` non matcha → silenzio totale in gruppo.
 */
export function parseWalletCommand(text: string): {
  matched: boolean;
  address: string;
} {
  const m = text
    .trim()
    .match(/^\/wallet(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return { matched: false, address: "" };
  return {
    matched: true,
    address: (m[1] ?? "").replace(/\s+/g, "").trim(),
  };
}

/**
 * Conferma testuale corta consegna digitale.
 * Alias legacy «ho spedito»/«spedito» restano accettati (deal mid-flight).
 */
function isShipConfirmText(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/[!!.]+$/g, "");
  return (
    t === "consegnato" ||
    t === "ho consegnato" ||
    t === "✅ consegnato" ||
    t === "materiale consegnato" ||
    t === "servizio inviato" ||
    t === "ho spedito" ||
    t === "spedito" ||
    t === "spedita" ||
    t === "📦 ho spedito"
  );
}

/**
 * Deal legato a questo gruppo. Se miss (migrazione group→supergroup), tenta heal.
 * Mai «Nessun deal collegato» se la card è live nello stesso chat.
 */
async function requireGroupDeal(ctx: BotContext): Promise<Deal | null> {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    return null;
  }
  return (
    (await findDealForGroupChat(
      ctx.api,
      ctx.store,
      ctx.chat.id,
      ctx.from?.id,
    )) ?? null
  );
}

function depositUnlocked(deal: Deal): boolean {
  return (
    deal.status === "awaiting_deposit" ||
    deal.status === "funded" ||
    deal.status === "release_pending" ||
    deal.status === "refund_pending" ||
    deal.status === "released" ||
    deal.status === "refunded" ||
    deal.status === "disputed"
  );
}

/** Testo alert callback (max 200, senza Markdown). */
function plainAlert(text: string): string {
  return text
    .replace(/[*_`[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Ruolo sbagliato / fuori turno:
 * - CLICK bottone: solo alert callback (niente delete, non avanza stato).
 * - WRITE testo/comando: elimina messaggio utente (soft-fail) + reminder turno.
 */
async function rejectWrongRole(
  ctx: BotContext,
  deal: Deal,
  text: string,
  opts?: { alert?: boolean; deleteUserMessage?: boolean },
): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: plainAlert(text),
      show_alert: opts?.alert ?? true,
    });
    return;
  }
  const chatId = deal.groupChatId ?? ctx.chat?.id;
  const msgId = ctx.message?.message_id;
  if (opts?.deleteUserMessage !== false && chatId != null && msgId != null) {
    ctx.dealLogs.markDeletedByBot(deal.id, msgId);
    await deleteMessageSafe(ctx.api, chatId, msgId);
  }
  await replaceRoleError(ctx.api, ctx.store, deal, text, {
    parse_mode: "Markdown",
  });
}

async function answerCbOk(ctx: BotContext): Promise<void> {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // già risposto
  }
}

/** Click → alert; write → delete + reminder. Niente wrongStatus spam in chat. */
async function rejectWrongStatus(
  ctx: BotContext,
  deal: Deal,
  status: string,
): Promise<void> {
  const text = it.wrongStatus(status);
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({
      text: plainAlert(text),
      show_alert: true,
    });
    return;
  }
  const chatId = deal.groupChatId ?? ctx.chat?.id;
  const msgId = ctx.message?.message_id;
  if (chatId != null && msgId != null) {
    ctx.dealLogs.markDeletedByBot(deal.id, msgId);
    await deleteMessageSafe(ctx.api, chatId, msgId);
  }
  await replaceRoleError(ctx.api, ctx.store, deal, text, {
    parse_mode: "Markdown",
  });
}

export function registerGroupCommandHandlers(bot: Bot<BotContext>): void {
  bot.command("indirizzo", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal) {
      if (ctx.chat?.type === "private") {
        await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(it.noDealInGroup);
      }
      return;
    }
    if (!depositUnlocked(deal)) {
      const chatId = deal.groupChatId ?? ctx.chat?.id;
      const msgId = ctx.message?.message_id;
      if (chatId != null && msgId != null) {
        ctx.dealLogs.markDeletedByBot(deal.id, msgId);
        await deleteMessageSafe(ctx.api, chatId, msgId);
      }
      await replaceRoleError(ctx.api, ctx.store, deal, it.notReadyForDeposit, {
        parse_mode: "Markdown",
      });
      return;
    }
    await replaceActionReply(ctx.api, ctx.store, deal, it.depositAddress(deal), {
      parse_mode: "Markdown",
    });
  });

  bot.command("depositato", async (ctx) => {
    await verifyDeposit(ctx);
  });

  // Case-insensitive: /wallet /Wallet /WALLET (+ @bot). Mai silenzio.
  bot.filter(
    (ctx) => {
      const text = ctx.message?.text ?? ctx.channelPost?.text;
      return Boolean(text && parseWalletCommand(text).matched);
    },
    async (ctx) => {
      await setWallet(ctx);
    },
  );

  bot.command("stato", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal) {
      await ctx.reply(it.noDealInGroup);
      return;
    }
    await replaceStatusMessage(ctx.api, ctx.store, deal, formatDealStatus(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status, deal),
    });
  });

  // Alias silenti: non in UI; restano per admin/compat.
  bot.command(["pay_seller", "payseller", "release"], async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  bot.command(["refund_buyer", "refundbuyer"], async (ctx) => {
    await handlePayOrRefund(ctx, "refund");
  });

  bot.command("dispute", async (ctx) => {
    await requestDisputeOpen(ctx);
  });

  bot.command("support", async (ctx) => {
    await replySupport(ctx);
  });

  bot.command("blockchain", async (ctx) => {
    await replyBlockchain(ctx);
  });

  /** Admin: ricollega un deal orfano noto a questo gruppo (store perso su redeploy). */
  bot.command(["ripristina", "relink"], async (ctx) => {
    await adminRipristina(ctx);
  });

  /**
   * Admin: payout one-shot senza store Telegram.
   * Uso: /admin_payout 82978c05 seller|buyer
   */
  bot.command(["admin_payout", "adminpayout"], async (ctx) => {
    await adminPayoutOrphan(ctx);
  });

  bot.callbackQuery("addr", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.notParty),
        show_alert: true,
      });
      return;
    }
    if (!depositUnlocked(deal)) {
      await ctx.answerCallbackQuery({ text: "Non ancora" });
      return;
    }
    await ctx.answerCallbackQuery();
    // Sostituisce verifica/stato/disputa precedenti: resta solo Indirizzo escrow.
    await replaceActionReply(ctx.api, ctx.store, deal, it.depositAddress(deal), {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery("funded", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.notParty),
        show_alert: true,
      });
      return;
    }
    if (await rejectFrozenInDispute(ctx, deal)) return;
    await ctx.answerCallbackQuery();
    await verifyDeposit(ctx, { ephemeral: true });
  });

  // Legacy callback id: redirect silenzioso (niente label UI).
  bot.callbackQuery("pay_seller", async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  bot.callbackQuery("refund_buyer", async (ctx) => {
    await handleStartRefund(ctx);
  });

  bot.callbackQuery("shipped", async (ctx) => {
    await handleSellerShipped(ctx);
  });

  bot.callbackQuery("buyer_pay", async (ctx) => {
    await handleBuyerPay(ctx);
  });

  bot.callbackQuery("buyer_info", async (ctx) => {
    await handleBuyerMoreInfo(ctx);
  });

  bot.callbackQuery("altre_info", async (ctx) => {
    await handleAltreInfo(ctx);
  });

  // Legacy: disputa era sul CTA buyer — ora sotto Altre info; stesso dual-confirm.
  bot.callbackQuery("buyer_dispute", async (ctx) => {
    await requestDisputeOpen(ctx, { ephemeral: true });
  });

  bot.callbackQuery("seller_confirm_pay", async (ctx) => {
    await handleSellerConfirmPay(ctx);
  });

  bot.callbackQuery("confirm_refund", async (ctx) => {
    await handleConfirmRefund(ctx);
  });

  bot.callbackQuery("cancel_confirm_pay", async (ctx) => {
    await handleCancelDualConfirm(ctx, "release");
  });

  bot.callbackQuery("cancel_confirm_refund", async (ctx) => {
    await handleCancelDualConfirm(ctx, "refund");
  });

  bot.callbackQuery("show_hash", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.notParty),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await handleShowHash(ctx);
  });

  bot.callbackQuery("dispute", async (ctx) => {
    await requestDisputeOpen(ctx, { ephemeral: true });
  });

  bot.callbackQuery("dispute_cancel", async (ctx) => {
    await requestDisputeCancel(ctx);
  });

  bot.callbackQuery("sc_yes", async (ctx) => {
    await handleSelfConfirmYes(ctx);
  });

  bot.callbackQuery("sc_back", async (ctx) => {
    await handleSelfConfirmBack(ctx);
  });

  bot.callbackQuery("stato", async (ctx) => {
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.notParty),
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    await replaceStatusMessage(ctx.api, ctx.store, deal, formatDealStatus(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status, deal),
    });
  });

  // Review post-pay, «consegnato», oppure wallet in chiaro.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await next();
      return;
    }

    if (reviewsPending(deal)) {
      await handleReviewText(ctx, deal, text);
      return;
    }

    if (
      deal.status === "funded" &&
      !deal.sellerShippedAt &&
      isShipConfirmText(text)
    ) {
      await handleSellerShipped(ctx, { userMessageId: ctx.message.message_id });
      return;
    }

    // Wallet turn: qualunque testo da parte sbagliata / terzo → delete + remind.
    if (
      deal.status === "awaiting_seller_wallet" ||
      deal.status === "awaiting_buyer_wallet"
    ) {
      const expected: "seller" | "buyer" =
        deal.status === "awaiting_seller_wallet" ? "seller" : "buyer";
      const expectedId =
        expected === "seller" ? deal.sellerId : deal.buyerId;
      const isExpected =
        expectedId != null &&
        (ctx.from.id === expectedId || isAdminUser(ctx.from.id));
      if (!isExpected) {
        await rejectWrongRole(ctx, deal, it.walletWrongTurn(deal, expected));
        return;
      }
      if (!isValidSolAddress(text)) {
        // Solo se sembra un wallet: delete + errore. Chat libera → next().
        if (!looksLikeSolAddressAttempt(text)) {
          await next();
          return;
        }
        const chatId = deal.groupChatId ?? ctx.chat.id;
        const msgId = ctx.message.message_id;
        ctx.dealLogs.markDeletedByBot(deal.id, msgId);
        await deleteMessageSafe(ctx.api, chatId, msgId);
        await replaceRoleError(ctx.api, ctx.store, deal, it.invalidWallet, {
          parse_mode: "Markdown",
        });
        return;
      }
      await applyWallet(ctx, deal, text);
      return;
    }

    await next();
  });
}

async function setWallet(ctx: BotContext): Promise<void> {
  try {
    const deal = await requireGroupDeal(ctx);
    if (!deal || !ctx.from) {
      await ctx.reply(it.noDealInGroup);
      return;
    }

    // Heal live chat id se migrazione group→supergroup ha lasciato id stale.
    if (
      ctx.chat?.id != null &&
      deal.groupChatId != null &&
      ctx.chat.id !== deal.groupChatId
    ) {
      remapDealGroupChatId(ctx.store, deal.groupChatId, ctx.chat.id);
    }
    const fresh = ctx.store.get(deal.id) ?? deal;

    // Turno wallet: /wallet da parte sbagliata o terzo → delete + remind.
    if (
      fresh.status === "awaiting_seller_wallet" ||
      fresh.status === "awaiting_buyer_wallet"
    ) {
      const expected: "seller" | "buyer" =
        fresh.status === "awaiting_seller_wallet" ? "seller" : "buyer";
      const expectedId =
        expected === "seller" ? fresh.sellerId : fresh.buyerId;
      const isExpected =
        expectedId != null &&
        (ctx.from.id === expectedId || isAdminUser(ctx.from.id));
      if (!isExpected) {
        await rejectWrongRole(ctx, fresh, it.walletWrongTurn(fresh, expected));
        return;
      }
    } else if (!isParty(fresh, ctx.from.id)) {
      await rejectWrongRole(ctx, fresh, it.notParty);
      return;
    }

    const text = ctx.message?.text ?? "";
    const parsed = parseWalletCommand(text);
    const address = parsed.address;
    if (!address || !isValidSolAddress(address)) {
      // Delete comando invalido + reminder corto (no stack usage lungo)
      const chatId = fresh.groupChatId ?? ctx.chat?.id;
      const msgId = ctx.message?.message_id;
      if (chatId != null && msgId != null) {
        ctx.dealLogs.markDeletedByBot(fresh.id, msgId);
        await deleteMessageSafe(ctx.api, chatId, msgId);
      }
      await replaceRoleError(ctx.api, ctx.store, fresh, it.invalidWallet, {
        parse_mode: "Markdown",
      });
      return;
    }

    await applyWallet(ctx, fresh, address);
  } catch (err) {
    console.error(
      "setWallet failed:",
      err instanceof Error ? err.message : err,
    );
    try {
      await ctx.reply(
        "Non sono riuscito a salvare il wallet. Riprova con `/wallet` seguito dall'indirizzo Solana.",
        { parse_mode: "Markdown" },
      );
    } catch {
      // chat morta / bot kickato
    }
  }
}

async function applyWallet(
  ctx: BotContext,
  deal: Deal,
  address: string,
): Promise<void> {
  if (!ctx.from) return;
  // Controparte invitata: /wallet senza soft signup (/start + @).
  // Solo l'opener deve essere iscritto (gate su /crea e wizard termini opener).

  const isBuyer = deal.buyerId === ctx.from.id;
  const isSeller = deal.sellerId === ctx.from.id;
  if (!isBuyer && !isSeller) {
    // Terzo: se siamo in turno wallet, reminder turno; altrimenti notParty.
    if (
      deal.status === "awaiting_seller_wallet" ||
      deal.status === "awaiting_buyer_wallet"
    ) {
      const expected =
        deal.status === "awaiting_seller_wallet" ? "seller" : "buyer";
      await rejectWrongRole(ctx, deal, it.walletWrongTurn(deal, expected));
      return;
    }
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }

  const chatId = deal.groupChatId ?? ctx.chat?.id;
  const userMessageId = ctx.message?.message_id;

  /**
   * Igiene wallet: clear prompt ask → next stage → delete risposta utente.
   * Posta il next step PRIMA di cancellare il messaggio utente: se send fallisce
   * l'utente vede ancora /wallet e può ritentare (mai silenzio).
   */
  const wipeWalletPrompts = async (current: Deal): Promise<Deal> => {
    let next = await clearRoleError(ctx.api, ctx.store, current);
    next = await clearBotPrompts(ctx.api, ctx.store, next);
    return next;
  };

  const deleteUserWalletMsg = async (current: Deal): Promise<void> => {
    const liveChatId = ctx.chat?.id ?? chatId;
    if (liveChatId != null && userMessageId != null) {
      ctx.dealLogs.markDeletedByBot(current.id, userMessageId);
      await deleteMessageSafe(ctx.api, liveChatId, userMessageId);
    }
  };

  // Dopo ToS: ordine fisso seller → buyer
  if (deal.status === "awaiting_seller_wallet") {
    if (!isSeller) {
      await rejectWrongRole(ctx, deal, it.walletWrongTurn(deal, "seller"));
      return;
    }
    const updated = ctx.store.update(deal.id, {
      sellerWallet: address,
      status: "awaiting_buyer_wallet",
    })!;
    ctx.dealLogs.appendEvent(updated.id, "Seller: wallet salvato");
    const cleaned = await wipeWalletPrompts(updated);
    await postAskBuyerWallet(ctx.api, ctx.store, cleaned);
    await deleteUserWalletMsg(cleaned);
    return;
  }

  if (deal.status === "awaiting_buyer_wallet") {
    if (!isBuyer) {
      await rejectWrongRole(ctx, deal, it.walletWrongTurn(deal, "buyer"));
      return;
    }
    const updated = ctx.store.update(deal.id, {
      buyerWallet: address,
      status: "awaiting_deposit",
    })!;
    ctx.dealLogs.appendEvent(updated.id, "Buyer: wallet salvato");
    const cleaned = await wipeWalletPrompts(updated);
    await postDealActivated(ctx.api, ctx.store, cleaned);
    await deleteUserWalletMsg(cleaned);
    return;
  }

  // Da awaiting_deposit in poi: wallet bloccati (anti destinazione payout swap)
  if (
    deal.status === "awaiting_deposit" ||
    deal.status === "funded" ||
    deal.status === "release_pending" ||
    deal.status === "refund_pending" ||
    deal.status === "disputed" ||
    deal.status === "released" ||
    deal.status === "refunded"
  ) {
    // Delete tentativo /wallet fuori turno; reminder soft.
    const chatIdLocked = deal.groupChatId ?? ctx.chat?.id;
    const msgIdLocked = ctx.message?.message_id;
    if (chatIdLocked != null && msgIdLocked != null) {
      ctx.dealLogs.markDeletedByBot(deal.id, msgIdLocked);
      await deleteMessageSafe(ctx.api, chatIdLocked, msgIdLocked);
    }
    await replaceRoleError(
      ctx.api,
      ctx.store,
      deal,
      it.walletLockedAfterDeposit(deal),
      { parse_mode: "Markdown" },
    );
    return;
  }

  // Pre-deposit / altro: delete + reminder corto (no wrongStatus spam)
  if (chatId != null && userMessageId != null) {
    ctx.dealLogs.markDeletedByBot(deal.id, userMessageId);
    await deleteMessageSafe(ctx.api, chatId, userMessageId);
  }
  await replaceRoleError(
    ctx.api,
    ctx.store,
    deal,
    it.wrongStatus(deal.status),
    { parse_mode: "Markdown" },
  );
}

async function verifyDeposit(
  ctx: BotContext,
  opts?: { ephemeral?: boolean },
): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;

  if (isPreDepositSetup(deal.status) || deal.status === "awaiting_counterpart") {
    const chatId = deal.groupChatId ?? ctx.chat?.id;
    const msgId = ctx.message?.message_id;
    if (chatId != null && msgId != null) {
      ctx.dealLogs.markDeletedByBot(deal.id, msgId);
      await deleteMessageSafe(ctx.api, chatId, msgId);
    }
    await replaceRoleError(ctx.api, ctx.store, deal, it.notReadyForDeposit, {
      parse_mode: "Markdown",
    });
    return;
  }

  const replyResult = async (
    current: Deal,
    text: string,
    withKeyboard: boolean,
  ): Promise<void> => {
    const extra = {
      parse_mode: "Markdown" as const,
      ...(withKeyboard
        ? { reply_markup: groupActionsKeyboard(current.status, current) }
        : {}),
    };
    if (opts?.ephemeral) {
      await replaceActionReply(ctx.api, ctx.store, current, text, extra);
      return;
    }
    await clearEphemeralReplies(ctx.api, ctx.store, current);
    await ctx.reply(text, extra);
  };

  // Admin: /depositato force → bypass on-chain (emergenza)
  const raw = ctx.message?.text ?? "";
  if (
    isAdminUser(ctx.from.id) &&
    deal.status === "awaiting_deposit" &&
    /\bforce\b/i.test(raw)
  ) {
    const updated = ctx.store.setStatus(deal.id, "funded")!;
    // postShipAsk chiude card Verifica + effimeri e passa allo ship ask.
    await postShipAsk(ctx.api, ctx.store, updated);
    return;
  }

  if (deal.status !== "awaiting_deposit" && deal.status !== "funded") {
    await rejectWrongStatus(ctx, deal, deal.status);
    return;
  }

  const result = await checkDealDeposit(ctx.store, deal.id);
  if (!result.ok) {
    await replyResult(
      deal,
      `Verifica deposito fallita: \`${result.error}\``,
      false,
    );
    return;
  }

  let fresh = ctx.store.get(deal.id)!;
  if (result.funded) {
    if (!fresh.sellerShippedAt) {
      // Chiude card Verifica deposito → ship ask (PR #28 flow).
      await postShipAsk(ctx.api, ctx.store, fresh);
      return;
    }
    // Già oltre lo ship: non ripostare CTA; solo ack effimero.
    await clearEphemeralReplies(ctx.api, ctx.store, fresh);
    await replyResult(
      fresh,
      it.depositCheckResult(fresh, result.balanceSol, true),
      false,
    );
    return;
  }
  // Underpay: testo effimero senza re-attaccare Verifica (resta sulla card stage).
  await replyResult(
    fresh,
    it.depositCheckResult(fresh, result.balanceSol, result.funded),
    false,
  );
}

/** Lock in-process: evita doppio sendAndConfirm concorrente sullo stesso deal. */
const payoutInFlight = new Set<string>();
/** Evita doppio tap sullo stesso voto (release/refund) prima che lo store aggiorni. */
const voteInFlight = new Set<string>();

function markPayoutCompleted(
  ctx: BotContext,
  dealId: string,
  kind: "release" | "refund",
  result: {
    signature: string;
    lamports: bigint;
    sellerLamports?: bigint;
    platformFeeLamports?: bigint;
    collaboratorFeeLamports?: bigint;
  },
): Deal | undefined {
  const doneStatus = kind === "release" ? "released" : "refunded";
  const updated = ctx.store.update(dealId, {
    status: doneStatus,
    payoutTxSig: result.signature,
    payoutCompleted: true,
    sellerPayoutLamports:
      kind === "release" && result.sellerLamports != null
        ? String(result.sellerLamports)
        : kind === "refund"
          ? String(result.lamports)
          : undefined,
    platformFeeLamports:
      kind === "release" && result.platformFeeLamports != null
        ? String(result.platformFeeLamports)
        : kind === "release"
          ? "0"
          : undefined,
    collaboratorFeeLamports:
      kind === "release" && result.collaboratorFeeLamports != null
        ? String(result.collaboratorFeeLamports)
        : kind === "release"
          ? "0"
          : undefined,
  });
  ctx.dealLogs.appendEvent(
    dealId,
    kind === "release"
      ? `Payout release ok · ${result.signature.slice(0, 8)}…`
      : `Payout refund ok · ${result.signature.slice(0, 8)}…`,
  );
  if (updated) {
    scheduleGroupCloseCleanup(ctx.store, updated);
    return ctx.store.get(dealId) ?? updated;
  }
  return updated;
}

/**
 * Escrow a 0 senza flag store: tipicamente tx già landata (crash/race).
 * Marca completed per evitare retry / confusioni admin.
 */
async function reconcileEmptyEscrow(
  ctx: BotContext,
  deal: Deal,
  kind: "release" | "refund",
): Promise<Deal> {
  const doneStatus = kind === "release" ? "released" : "refunded";
  const updated =
    ctx.store.update(deal.id, {
      status: doneStatus,
      payoutCompleted: true,
      // Conserva sig se già nota; altrimenti lascia undefined (on-chain sola fonte)
      payoutTxSig: deal.payoutTxSig,
    }) ?? deal;
  console.error(
    `Payout empty_escrow reconciled #${deal.id} kind=${kind} status→${doneStatus}` +
      (deal.payoutTxSig ? ` tx=${deal.payoutTxSig}` : " (no stored sig)"),
  );
  scheduleGroupCloseCleanup(ctx.store, updated);
  return ctx.store.get(updated.id) ?? updated;
}

async function runPayout(
  ctx: BotContext,
  deal: Deal,
  kind: "release" | "refund",
): Promise<void> {
  // Rileggi store: evita race su payoutCompleted / wallet
  const fresh = ctx.store.get(deal.id) ?? deal;

  // Idempotenza: già completato → non ritentare on-chain
  if (
    fresh.payoutCompleted ||
    (fresh.payoutTxSig &&
      (fresh.status === "released" || fresh.status === "refunded"))
  ) {
    await ctx.reply(it.payoutAlreadyDone(fresh), { parse_mode: "Markdown" });
    return;
  }

  if (payoutInFlight.has(fresh.id)) {
    await ctx.reply(it.payoutBusy(fresh), { parse_mode: "Markdown" });
    return;
  }

  const dest = kind === "release" ? fresh.sellerWallet : fresh.buyerWallet;
  const who = kind === "release" ? "seller" : "buyer";
  if (!dest) {
    await ctx.reply(it.needWallet(who), { parse_mode: "Markdown" });
    return;
  }

  payoutInFlight.add(fresh.id);
  let progressMsgId: number | undefined;
  try {
    const progress = await ctx.reply(
      kind === "release" ? it.releaseVote(fresh, 0) : it.refundVote(fresh, 0),
      { parse_mode: "Markdown" },
    );
    progressMsgId = progress.message_id;

    // Snapshot collab wallet dal deal (non da InviteStore live — anti-steal)
    const collab =
      kind === "release" && fresh.collaboratorWallet?.trim()
        ? fresh.collaboratorWallet.trim()
        : undefined;

    const result = await payoutDealSol(fresh.id, dest, {
      kind,
      collaboratorWallet: collab,
    });

    if (!result.ok) {
      if (progressMsgId != null && ctx.chat) {
        await deleteMessageSafe(ctx.api, ctx.chat.id, progressMsgId);
        progressMsgId = undefined;
      }
      if (result.errorCode === "empty_escrow") {
        const bal = fresh.escrowAddress
          ? await getEscrowBalanceLamports(fresh.escrowAddress).catch(() => 0n)
          : 0n;
        if (bal === 0n) {
          const reconciled = await reconcileEmptyEscrow(ctx, fresh, kind);
          await ctx.reply(it.payoutReconciledEmpty(reconciled), {
            parse_mode: "Markdown",
          });
          return;
        }
      }
      await ctx.reply(it.payoutFailed(fresh, result.error), {
        parse_mode: "Markdown",
        reply_markup: groupActionsKeyboard(fresh.status, fresh),
      });
      return;
    }

    if (progressMsgId != null && ctx.chat) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, progressMsgId);
      progressMsgId = undefined;
    }

    let updated = markPayoutCompleted(ctx, fresh.id, kind, result)!;
    updated = await clearRoleError(ctx.api, ctx.store, updated);
    updated = await clearBotPrompts(ctx.api, ctx.store, updated);
    await clearEphemeralReplies(ctx.api, ctx.store, updated);

    // Release con review: un solo «Grazie…» collettivo, poi messaggio Hash.
    if (
      kind === "release" &&
      (updated.sellerReviewText || updated.buyerReviewText)
    ) {
      try {
        await ctx.reply(it.reviewThanksBoth);
      } catch (err) {
        console.warn(
          `runPayout #${updated.id} reviewThanksBoth failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const body = it.payoutSuccess(updated, kind, result.signature, result.sol, {
      platformFeeSol:
        result.platformFeeLamports != null
          ? lamportsToSolString(result.platformFeeLamports)
          : undefined,
      collaboratorFeeSol:
        result.collaboratorFeeLamports != null &&
        result.collaboratorFeeLamports > 0n
          ? lamportsToSolString(result.collaboratorFeeLamports)
          : undefined,
      feeWallet: result.feeWallet,
      collaboratorWallet: result.collaboratorWallet,
    });
    // Nessun link tx nel body: solo bottone Hash (sig in chiaro al tap).
    await ctx.reply(body, {
      parse_mode: "Markdown",
      reply_markup: payoutHashKeyboard(),
    });
  } catch (err) {
    // Senza catch: dopo «Rilascio in corso» un throw RPC lasciava chat senza follow-up
    // (solo bot.catch log). Lock liberato in finally → retry ok.
    if (progressMsgId != null && ctx.chat) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, progressMsgId);
    }
    const classified = classifyPayoutError(err);
    console.error(
      `runPayout #${fresh.id} kind=${kind} uncaught: ${classified.code} — ${classified.message}`,
      err instanceof Error ? err.message : err,
    );
    try {
      await ctx.reply(it.payoutFailed(fresh, classified.message), {
        parse_mode: "Markdown",
        reply_markup: groupActionsKeyboard(fresh.status, fresh),
      });
    } catch (replyErr) {
      console.error(
        `runPayout #${fresh.id} fail-reply also failed:`,
        replyErr instanceof Error ? replyErr.message : replyErr,
      );
    }
  } finally {
    payoutInFlight.delete(fresh.id);
  }
}

async function handlePayOrRefund(
  ctx: BotContext,
  kind: "release" | "refund",
  opts?: { asUserId?: number; afterSelfConfirm?: boolean },
): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }

  if (deal.status === "disputed" && isAdminUser(ctx.from.id)) {
    await answerCbOk(ctx);
    await runPayout(ctx, deal, kind);
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;

  // Admin può proxy-are un voto di ruolo; il voto va attribuito alla parte, non all'admin.
  const voterId = opts?.asUserId ?? ctx.from.id;

  if (!isParty(deal, voterId) && !isParty(deal, ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }

  if (!deal.buyerId || !deal.sellerId) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Mancano buyer o seller" });
    } else {
      await ctx.reply("Mancano ancora buyer o seller nel deal.");
    }
    return;
  }

  // Conflitto verso opposto: release_pending ≠ refund e viceversa
  if (
    (kind === "release" && deal.status === "refund_pending") ||
    (kind === "refund" && deal.status === "release_pending")
  ) {
    await answerCbOk(ctx);
    await replaceActionReply(
      ctx.api,
      ctx.store,
      deal,
      it.confirmConflict(
        deal,
        deal.status === "release_pending" ? "release" : "refund",
      ),
      { parse_mode: "Markdown" },
    );
    return;
  }

  const allowed =
    kind === "release"
      ? ["funded", "release_pending"]
      : ["funded", "refund_pending"];

  if (!allowed.includes(deal.status)) {
    await rejectWrongStatus(ctx, deal, deal.status);
    return;
  }

  const dest = kind === "release" ? deal.sellerWallet : deal.buyerWallet;
  if (!dest) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.needWallet(kind === "release" ? "seller" : "buyer")),
        show_alert: true,
      });
    } else {
      await ctx.reply(it.needWallet(kind === "release" ? "seller" : "buyer"), {
        parse_mode: "Markdown",
      });
    }
    return;
  }

  const lockKey = `${deal.id}:${kind}:${voterId}`;
  if (voteInFlight.has(lockKey)) {
    await answerCbOk(ctx);
    return;
  }
  voteInFlight.add(lockKey);

  try {
    // Merge voto sul record fresco (sync get→update: no await in mezzo)
    const latest = ctx.store.get(deal.id) ?? deal;
    if (
      latest.payoutCompleted ||
      latest.status === "released" ||
      latest.status === "refunded"
    ) {
      await answerCbOk(ctx);
      await ctx.reply(it.payoutAlreadyDone(latest), { parse_mode: "Markdown" });
      return;
    }
    if (
      (kind === "release" && latest.status === "refund_pending") ||
      (kind === "refund" && latest.status === "release_pending")
    ) {
      await answerCbOk(ctx);
      await replaceActionReply(
        ctx.api,
        ctx.store,
        latest,
        it.confirmConflict(
          latest,
          latest.status === "release_pending" ? "release" : "refund",
        ),
        { parse_mode: "Markdown" },
      );
      return;
    }
    const allowedNow =
      kind === "release"
        ? ["funded", "release_pending"]
        : ["funded", "refund_pending"];
    if (!allowedNow.includes(latest.status)) {
      await rejectWrongStatus(ctx, latest, latest.status);
      return;
    }

    const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
    const prevVotes = latest[voteKey];

    // Già 2/2 release: riprendi review o payout (crash / re-tap / alreadyVoted).
    if (
      kind === "release" &&
      prevVotes.length >= 2 &&
      !latest.payoutCompleted
    ) {
      await answerCbOk(ctx);
      await afterReleaseVotesReady(ctx, latest);
      return;
    }

    if (prevVotes.includes(voterId)) {
      await answerCbOk(ctx);
      await replaceActionReply(
        ctx.api,
        ctx.store,
        latest,
        it.alreadyVoted(latest, kind),
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Release: buyer-first. Seller/comando non può votare prima del buyer.
    if (
      kind === "release" &&
      latest.buyerId != null &&
      !prevVotes.includes(latest.buyerId) &&
      voterId !== latest.buyerId
    ) {
      await rejectWrongRole(ctx, latest, it.releaseNeedBuyerFirst(latest));
      return;
    }

    // Secondo voto: solo la parte ancora in attesa (tag = chi può premere).
    if (prevVotes.length === 1) {
      const expectedId = pendingVoterId(latest, prevVotes);
      if (expectedId != null && voterId !== expectedId) {
        await rejectWrongRole(ctx, latest, it.onlyPendingConfirm(latest, kind));
        return;
      }
    }

    // Primo voto: richiede «Sei sicuro?» same-@ (click accidentale non apre 1/2).
    if (prevVotes.length === 0 && !opts?.afterSelfConfirm) {
      voteInFlight.delete(lockKey);
      await beginSelfConfirm(
        ctx,
        latest,
        kind === "release" ? "release" : "refund",
        voterId,
      );
      return;
    }

    await answerCbOk(ctx);

    const votes = addUniqueVote(prevVotes, voterId);
    const pendingStatus =
      kind === "release" ? "release_pending" : "refund_pending";
    const done = votes.length >= 2;

    const pending = ctx.store.update(latest.id, {
      [voteKey]: votes,
      status: pendingStatus,
    })!;

    if (!done) {
      const remaining = Math.max(0, 2 - votes.length);
      const msg =
        kind === "release"
          ? it.releaseVote(pending, remaining)
          : it.refundVote(pending, remaining);
      // Togli prompt CTAs precedenti; 1/2 con bottone allineato al tag.
      await clearBotPrompts(ctx.api, ctx.store, pending);
      await clearRoleError(ctx.api, ctx.store, pending);
      await sendTrackedPrompt(ctx.api, ctx.store, pending, msg, {
        parse_mode: "Markdown",
        reply_markup:
          kind === "release"
            ? sellerConfirmPayKeyboard()
            : refundConfirmKeyboard(),
      });
      return;
    }

    await clearRoleError(ctx.api, ctx.store, pending);

    // Refund: payout immediato. Release: review seller→buyer, poi payout.
    if (kind === "refund") {
      await runPayout(ctx, pending, kind);
      return;
    }
    await afterReleaseVotesReady(ctx, pending);
  } finally {
    voteInFlight.delete(lockKey);
  }
}

/**
 * Dopo 2/2 pay-seller: gate review (seller poi buyer), poi on-chain release.
 * Saltato su refund e su force admin in disputa.
 */
async function afterReleaseVotesReady(
  ctx: BotContext,
  deal: Deal,
): Promise<void> {
  const { deal: current, readyForPayout } = await beginOrContinueReviews(
    ctx.api,
    ctx.store,
    deal,
  );
  if (readyForPayout) {
    await runPayout(ctx, current, "release");
  }
}

async function handleReviewText(
  ctx: BotContext,
  deal: Deal,
  text: string,
): Promise<void> {
  if (!ctx.from) return;
  const who = expectedReviewer(deal);
  const result = await acceptReviewAnswer(
    ctx.api,
    ctx.store,
    deal,
    ctx.from.id,
    text,
    ctx.message?.message_id,
  );
  if (!result.ok) {
    if (result.reason === "too_short") {
      const chatId = deal.groupChatId ?? ctx.chat?.id;
      const msgId = ctx.message?.message_id;
      if (chatId != null && msgId != null) {
        ctx.dealLogs.markDeletedByBot(deal.id, msgId);
        await deleteMessageSafe(ctx.api, chatId, msgId);
      }
      await replaceRoleError(ctx.api, ctx.store, deal, it.reviewTooShort, {
        parse_mode: "Markdown",
      });
      return;
    }
    if (result.reason === "wrong_party" && who) {
      await rejectWrongRole(ctx, deal, it.reviewWrongParty(deal, who));
      return;
    }
    // Altro reject (es. not pending): delete junk, no hang
    const chatId = deal.groupChatId ?? ctx.chat?.id;
    const msgId = ctx.message?.message_id;
    if (chatId != null && msgId != null) {
      ctx.dealLogs.markDeletedByBot(deal.id, msgId);
      await deleteMessageSafe(ctx.api, chatId, msgId);
    }
    return;
  }
  if (ctx.message?.message_id != null) {
    ctx.dealLogs.markDeletedByBot(deal.id, ctx.message.message_id);
  }
  ctx.dealLogs.appendEvent(
    result.deal.id,
    who === "seller" ? "Review seller ricevuta" : "Review buyer ricevuta",
  );
  await clearRoleError(ctx.api, ctx.store, result.deal);
  if (result.readyForPayout) {
    await runPayout(ctx, result.deal, "release");
  }
}

async function handleSellerShipped(
  ctx: BotContext,
  opts?: { userMessageId?: number },
): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;
  // Seller-only (buyer anche se admin → alert, mai avanzare).
  if (!canMarkShipped(deal, ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.shipOnlySeller(deal));
    return;
  }
  if (deal.status !== "funded" && deal.status !== "release_pending") {
    if (!ctx.callbackQuery && opts?.userMessageId != null) {
      // handleSellerShipped passa userMessageId esplicito
      const chatId = deal.groupChatId ?? ctx.chat?.id;
      if (chatId != null) {
        ctx.dealLogs.markDeletedByBot(deal.id, opts.userMessageId);
        await deleteMessageSafe(ctx.api, chatId, opts.userMessageId);
      }
      await replaceRoleError(
        ctx.api,
        ctx.store,
        deal,
        it.wrongStatus(deal.status),
        { parse_mode: "Markdown" },
      );
      return;
    }
    await rejectWrongStatus(ctx, deal, deal.status);
    return;
  }
  await answerCbOk(ctx);
  if (deal.sellerShippedAt) {
    // Idempotente: ripubblica CTA buyer se serve.
    await postBuyerAfterShip(ctx.api, ctx.store, deal);
    return;
  }

  const chatId = deal.groupChatId;
  if (chatId != null && opts?.userMessageId != null) {
    ctx.dealLogs.markDeletedByBot(deal.id, opts.userMessageId);
    await deleteMessageSafe(ctx.api, chatId, opts.userMessageId);
  }

  let updated =
    ctx.store.update(deal.id, {
      sellerShippedAt: new Date().toISOString(),
    }) ?? deal;

  ctx.dealLogs.appendEvent(updated.id, "Seller: consegnato");

  updated = await clearRoleError(ctx.api, ctx.store, updated);
  await clearBotPrompts(ctx.api, ctx.store, updated);
  await clearEphemeralReplies(ctx.api, ctx.store, updated);
  await postBuyerAfterShip(ctx.api, ctx.store, updated);
}

/** Buyer avvia rilascio: prima «Sei sicuro?» same-@, poi voto 1 → seller conferma. */
async function handleBuyerPay(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;
  if (deal.buyerId == null) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Mancano buyer o seller" });
    } else {
      await ctx.reply("Mancano ancora buyer o seller nel deal.");
    }
    return;
  }
  if (deal.buyerId !== ctx.from.id && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.buyerOnlyPay(deal));
    return;
  }
  if (!deal.sellerShippedAt && deal.status === "funded") {
    await rejectWrongRole(ctx, deal, it.needShipFirst(deal));
    return;
  }
  await clearRoleError(ctx.api, ctx.store, deal);
  // Click accidentale non deve aprire il voto 1/2: prima conferma clicker.
  if (!buyerHasReleaseVote(deal)) {
    await beginSelfConfirm(ctx, deal, "release", deal.buyerId);
    return;
  }
  // Admin proxy: attribuisci il voto al buyer, non all'admin id.
  await handlePayOrRefund(ctx, "release", { asUserId: deal.buyerId });
}

/** Seller conferma il secondo voto di rilascio. */
async function handleSellerConfirmPay(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (deal.sellerId == null || deal.buyerId == null) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Mancano buyer o seller" });
    } else {
      await ctx.reply("Mancano ancora buyer o seller nel deal.");
    }
    return;
  }
  if (!buyerHasReleaseVote(deal)) {
    await rejectWrongRole(ctx, deal, it.releaseNeedBuyerFirst(deal));
    return;
  }
  if (deal.sellerId !== ctx.from.id && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.onlyPendingConfirm(deal, "release"));
    return;
  }
  await clearRoleError(ctx.api, ctx.store, deal);
  // Admin proxy: attribuisci il voto al seller.
  await handlePayOrRefund(ctx, "release", { asUserId: deal.sellerId });
}

/**
 * Avvio rimborso mutuale. Prima «Sei sicuro?» same-@, poi voto 1/2.
 * Admin in disputa forza payout. Terzi → alert.
 */
async function handleStartRefund(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  // In disputa: admin forza on-chain subito (come /refund_buyer).
  if (deal.status === "disputed" && isAdminUser(ctx.from.id)) {
    await handlePayOrRefund(ctx, "refund");
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;
  // Solo buyer/seller avviano i voti; terzi → alert, nessuno stato.
  if (!isParty(deal, ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }
  await clearRoleError(ctx.api, ctx.store, deal);
  // Nessun voto ancora → conferma clicker prima di aprire 1/2.
  if (deal.refundVotes.length === 0) {
    await beginSelfConfirm(ctx, deal, "refund", ctx.from.id);
    return;
  }
  await handlePayOrRefund(ctx, "refund", { asUserId: ctx.from.id });
}

/** Parte in attesa conferma il secondo voto di rimborso. */
async function handleConfirmRefund(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  const expectedId = pendingVoterId(deal, deal.refundVotes);
  if (expectedId == null) {
    await answerCbOk(ctx);
    if (deal.refundVotes.includes(ctx.from.id) || isAdminUser(ctx.from.id)) {
      await replaceActionReply(
        ctx.api,
        ctx.store,
        deal,
        it.alreadyVoted(deal, "refund"),
        { parse_mode: "Markdown" },
      );
    }
    return;
  }
  if (ctx.from.id !== expectedId && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.onlyPendingConfirm(deal, "refund"));
    return;
  }
  await clearRoleError(ctx.api, ctx.store, deal);
  await handlePayOrRefund(ctx, "refund", { asUserId: expectedId });
}

/**
 * Abort dual-confirm 1/2 (ultimo voto non ancora dato).
 * Solo parti (o admin): azzera voti → funded; ripristina CTA; Disputa resta sotto Altre info.
 */
async function handleCancelDualConfirm(
  ctx: BotContext,
  kind: "release" | "refund",
): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }

  const pendingStatus = kind === "release" ? "release_pending" : "refund_pending";
  const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
  const votes = deal[voteKey];

  // Solo con conferma aperta (1/2): niente da abortire altrimenti.
  if (deal.status !== pendingStatus || votes.length === 0) {
    await answerCbOk(ctx);
    return;
  }
  // 2/2 già chiuso / payout in corso: troppo tardi.
  if (votes.length >= 2 || deal.payoutCompleted) {
    await answerCbOk(ctx);
    return;
  }

  await answerCbOk(ctx);

  let updated =
    ctx.store.update(deal.id, {
      [voteKey]: [],
      status: "funded",
      pendingSelfConfirm: undefined,
    }) ?? deal;

  updated = await clearEphemeralReplies(ctx.api, ctx.store, updated);
  updated = await clearRoleError(ctx.api, ctx.store, updated);
  updated = await clearBotPrompts(ctx.api, ctx.store, updated);

  // Niente notice permanente: un solo CTA ripristinato (no stack).
  if (updated.sellerShippedAt) {
    await postBuyerAfterShip(ctx.api, ctx.store, updated);
  } else {
    await postShipAsk(ctx.api, ctx.store, updated);
  }
}

async function handleBuyerMoreInfo(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (await rejectFrozenInDispute(ctx, deal)) return;
  if (deal.buyerId !== ctx.from.id && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.buyerOnlyPay(deal));
    return;
  }
  await answerCbOk(ctx);
  // Avvisa seller + Disputa sotto Altre info (non accanto a Paga).
  await replaceActionReply(
    ctx.api,
    ctx.store,
    deal,
    it.askSellerMoreInfo(deal),
    {
      parse_mode: "Markdown",
      reply_markup: altreInfoKeyboard(),
    },
  );
}

/** Percorso secondario: Disputa (fuori dal path paga / verifica deposito). */
async function handleAltreInfo(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }
  if (deal.status === "disputed") {
    await ctx.answerCallbackQuery({
      text: plainAlert(it.disputeAlreadyOpen),
      show_alert: true,
    });
    return;
  }
  await answerCbOk(ctx);
  await replaceActionReply(ctx.api, ctx.store, deal, it.altreInfoMenu(deal), {
    parse_mode: "Markdown",
    reply_markup: altreInfoKeyboard(),
  });
}

async function handleShowHash(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!deal.payoutTxSig) {
    await replaceActionReply(ctx.api, ctx.store, deal, it.payoutHashMissing);
    return;
  }
  await replaceActionReply(
    ctx.api,
    ctx.store,
    deal,
    it.payoutHashReveal(deal.payoutTxSig),
    { parse_mode: "Markdown" },
  );
}

async function replySupport(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type === "private") {
    await ctx.reply(it.supportDm, { parse_mode: "Markdown" });
    return;
  }
  const deal = await requireGroupDeal(ctx);
  if (!deal) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  await ctx.reply(it.supportGroup, { parse_mode: "Markdown" });
}

async function replyBlockchain(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal) {
    if (ctx.chat?.type === "private") {
      await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (!deal.payoutTxSig) {
    await ctx.reply(it.blockchainMissing);
    return;
  }
  const url = `https://solscan.io/tx/${deal.payoutTxSig}`;
  await ctx.reply(it.blockchainLink(deal, url), { parse_mode: "Markdown" });
}

/** Alert corto se lo stato è disputed — niente spam `Azione non disponibile`. */
async function rejectFrozenInDispute(
  ctx: BotContext,
  deal: Deal,
): Promise<boolean> {
  if (deal.status !== "disputed") return false;
  if (ctx.callbackQuery) {
    try {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.frozenInDispute),
        show_alert: true,
      });
    } catch {
      // già risposto (es. answer OK prima del check)
    }
    return true;
  }
  await rejectWrongRole(ctx, deal, it.frozenInDispute);
  return true;
}

/**
 * Prompt «Sei sicuro…?» same-@ con Sì / ← Indietro.
 * Non cancella i CTA di stage: Indietro ripristina chiudendo solo l'effimero.
 */
async function beginSelfConfirm(
  ctx: BotContext,
  deal: Deal,
  kind: SelfConfirmKind,
  userId: number,
): Promise<void> {
  await answerCbOk(ctx);
  const updated =
    ctx.store.update(deal.id, {
      pendingSelfConfirm: { kind, userId },
    }) ?? deal;
  await replaceActionReply(
    ctx.api,
    ctx.store,
    updated,
    it.selfConfirmAsk(updated, kind, userId),
    {
      parse_mode: "Markdown",
      reply_markup: selfConfirmKeyboard(),
    },
  );
}

async function clearPendingSelfConfirm(
  ctx: BotContext,
  deal: Deal,
): Promise<Deal> {
  let current = await clearEphemeralReplies(ctx.api, ctx.store, deal);
  if (current.pendingSelfConfirm) {
    current =
      ctx.store.update(current.id, { pendingSelfConfirm: undefined }) ??
      current;
  }
  return current;
}

async function handleSelfConfirmYes(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.answerCallbackQuery({ text: "Nessun deal" });
    return;
  }
  const pending = deal.pendingSelfConfirm;
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Conferma scaduta" });
    await clearEphemeralReplies(ctx.api, ctx.store, deal);
    return;
  }
  if (ctx.from.id !== pending.userId) {
    await ctx.answerCallbackQuery({
      text: plainAlert(it.selfConfirmWrongUser(deal, pending.userId)),
      show_alert: true,
    });
    return;
  }
  await answerCbOk(ctx);
  const kind = pending.kind;
  const userId = pending.userId;
  const cleared = await clearPendingSelfConfirm(ctx, deal);

  if (kind === "dispute_open") {
    await executeDisputeOpen(ctx, cleared, userId, { ephemeral: true });
    return;
  }
  if (kind === "dispute_cancel") {
    await executeDisputeCancel(ctx, cleared, userId);
    return;
  }
  if (kind === "release") {
    await handlePayOrRefund(ctx, "release", {
      asUserId: userId,
      afterSelfConfirm: true,
    });
    return;
  }
  await handlePayOrRefund(ctx, "refund", {
    asUserId: userId,
    afterSelfConfirm: true,
  });
}

async function handleSelfConfirmBack(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.answerCallbackQuery({ text: "Nessun deal" });
    return;
  }
  const pending = deal.pendingSelfConfirm;
  if (!pending) {
    await answerCbOk(ctx);
    await clearEphemeralReplies(ctx.api, ctx.store, deal);
    return;
  }
  if (ctx.from.id !== pending.userId) {
    await ctx.answerCallbackQuery({
      text: plainAlert(it.selfConfirmWrongUser(deal, pending.userId)),
      show_alert: true,
    });
    return;
  }
  await answerCbOk(ctx);
  // Igiene: togli solo il prompt conferma; i CTA stage restano.
  await clearPendingSelfConfirm(ctx, deal);
}

/** Click Disputa / /dispute → conferma same-@ prima di aprire. */
async function requestDisputeOpen(
  ctx: BotContext,
  opts?: { ephemeral?: boolean },
): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }
  if (deal.status === "disputed") {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.disputeAlreadyOpen),
        show_alert: true,
      });
    } else {
      await rejectWrongRole(ctx, deal, it.disputeAlreadyOpen);
    }
    return;
  }
  if (
    deal.status === "released" ||
    deal.status === "refunded" ||
    deal.status === "cancelled"
  ) {
    await rejectWrongStatus(ctx, deal, deal.status);
    return;
  }
  if (deal.groupChatId == null) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
    } else {
      await ctx.reply(it.noDealInGroup);
    }
    return;
  }
  void opts;
  await beginSelfConfirm(ctx, deal, "dispute_open", ctx.from.id);
}

/** Annulla disputa: solo opener, con conferma same-@. */
async function requestDisputeCancel(ctx: BotContext): Promise<void> {
  const deal = await requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.answerCallbackQuery({ text: "Nessun deal" });
    return;
  }
  if (deal.status !== "disputed") {
    await ctx.answerCallbackQuery({
      text: plainAlert(it.wrongStatus(deal.status)),
      show_alert: true,
    });
    return;
  }
  // Solo opener (stesso @); mid-flight senza disputeOpenedBy → parte del deal.
  if (deal.disputeOpenedBy != null) {
    if (ctx.from.id !== deal.disputeOpenedBy) {
      await ctx.answerCallbackQuery({
        text: plainAlert(it.disputeCancelOnlyOpener(deal)),
        show_alert: true,
      });
      return;
    }
  } else if (!isParty(deal, ctx.from.id)) {
    await rejectWrongRole(ctx, deal, it.notParty);
    return;
  }
  await beginSelfConfirm(ctx, deal, "dispute_cancel", ctx.from.id);
}

async function executeDisputeOpen(
  ctx: BotContext,
  deal: Deal,
  openerId: number,
  opts?: { ephemeral?: boolean },
): Promise<void> {
  if (!ctx.from) return;
  if (deal.groupChatId == null) return;
  if (deal.status === "disputed") {
    await replaceActionReply(ctx.api, ctx.store, deal, it.disputeAlreadyOpen);
    return;
  }

  let adminLink = deal.adminInviteLink;
  if (!adminLink) {
    adminLink = await createAdminInviteLink(ctx.api, deal.groupChatId, deal.id);
  }

  const before: DealStatus = deal.status;
  let updated =
    ctx.store.update(deal.id, {
      status: "disputed",
      adminInviteLink: adminLink,
      disputeOpenedBy: openerId,
      statusBeforeDispute: before,
      pendingSelfConfirm: undefined,
    }) ?? deal;

  ctx.dealLogs.appendEvent(
    updated.id,
    `Disputa aperta da ${ctx.from.username ? `@${ctx.from.username}` : openerId}`,
  );

  // Togli CTA soldi (Paga / Rimborsa / Consegnato / Verifica) — niente bottoni morti.
  updated = await clearBotPrompts(ctx.api, ctx.store, updated);
  updated = await clearRoleError(ctx.api, ctx.store, updated);

  const opened = it.disputeOpened(updated);
  const disputedKb = groupActionsKeyboard(updated.status, updated);
  if (opts?.ephemeral !== false) {
    await replaceActionReply(ctx.api, ctx.store, updated, opened, {
      parse_mode: "Markdown",
      reply_markup: disputedKb,
    });
  } else {
    await clearEphemeralReplies(ctx.api, ctx.store, updated);
    await ctx.reply(opened, {
      parse_mode: "Markdown",
      reply_markup: disputedKb,
    });
  }

  const adminIds = config.adminTelegramIds;
  if (!adminIds.length) {
    await ctx.reply(it.adminMissing);
    return;
  }

  const notifyBody = it.disputeAdminNotify(
    updated,
    openerId,
    ctx.from.username,
    adminLink,
  );
  let anyOk = false;
  for (const adminId of adminIds) {
    try {
      await ctx.api.sendMessage(adminId, notifyBody);
      anyOk = true;
    } catch (err) {
      console.error(`Notifica admin ${adminId} fallita:`, err);
    }
  }
  if (!anyOk) {
    await ctx.reply(
      "Disputa aperta ma non riesco a scrivere all'admin in privato (deve aver avviato il bot).",
    );
  }
}

async function executeDisputeCancel(
  ctx: BotContext,
  deal: Deal,
  userId: number,
): Promise<void> {
  if (deal.status !== "disputed") return;

  if (deal.disputeOpenedBy != null && userId !== deal.disputeOpenedBy) {
    await replaceActionReply(
      ctx.api,
      ctx.store,
      deal,
      it.disputeCancelOnlyOpener(deal),
      { parse_mode: "Markdown" },
    );
    return;
  }

  const restoreStatus: DealStatus = deal.statusBeforeDispute ?? "funded";
  let updated =
    ctx.store.update(deal.id, {
      status: restoreStatus,
      disputeOpenedBy: undefined,
      statusBeforeDispute: undefined,
      pendingSelfConfirm: undefined,
    }) ?? deal;

  ctx.dealLogs.appendEvent(
    updated.id,
    `Disputa annullata da ${ctx.from?.username ? `@${ctx.from.username}` : userId}`,
  );

  updated = await clearEphemeralReplies(ctx.api, ctx.store, updated);
  updated = await clearRoleError(ctx.api, ctx.store, updated);
  updated = await clearBotPrompts(ctx.api, ctx.store, updated);

  // Niente notice permanente: restore CTA stage only (no stack).
  await restoreUiAfterDisputeCancel(ctx, updated);
}

/** Ripristina CTA stage dopo annulla disputa (es. awaiting pay). */
async function restoreUiAfterDisputeCancel(
  ctx: BotContext,
  deal: Deal,
): Promise<void> {
  if (deal.status === "awaiting_deposit") {
    await postDealActivated(ctx.api, ctx.store, deal);
    return;
  }
  if (deal.status === "funded") {
    if (deal.sellerShippedAt) {
      await postBuyerAfterShip(ctx.api, ctx.store, deal);
    } else {
      await postShipAsk(ctx.api, ctx.store, deal);
    }
    return;
  }
  if (deal.status === "release_pending") {
    const remaining = Math.max(0, 2 - deal.releaseVotes.length);
    if (remaining > 0 && buyerHasReleaseVote(deal)) {
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        deal,
        it.releaseVote(deal, remaining),
        {
          parse_mode: "Markdown",
          reply_markup: sellerConfirmPayKeyboard(),
        },
      );
      return;
    }
    if (deal.sellerShippedAt) {
      await postBuyerAfterShip(ctx.api, ctx.store, deal);
    } else {
      await postShipAsk(ctx.api, ctx.store, deal);
    }
    return;
  }
  if (deal.status === "refund_pending") {
    const remaining = Math.max(0, 2 - deal.refundVotes.length);
    if (remaining > 0 && deal.refundVotes.length > 0) {
      await sendTrackedPrompt(
        ctx.api,
        ctx.store,
        deal,
        it.refundVote(deal, remaining),
        {
          parse_mode: "Markdown",
          reply_markup: refundConfirmKeyboard(),
        },
      );
      return;
    }
    if (deal.sellerShippedAt) {
      await postBuyerAfterShip(ctx.api, ctx.store, deal);
    } else {
      await postShipAsk(ctx.api, ctx.store, deal);
    }
    return;
  }
  // Fallback: tastiera stato.
  await replaceStatusMessage(
    ctx.api,
    ctx.store,
    deal,
    formatDealStatus(deal),
    {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status, deal),
    },
  );
}

/** @deprecated Preferire requestDisputeOpen; tenuto per import esterni. */
export async function openDispute(
  ctx: BotContext,
  opts?: { ephemeral?: boolean; buyerOnly?: boolean },
): Promise<void> {
  void opts?.buyerOnly;
  await requestDisputeOpen(ctx, { ephemeral: opts?.ephemeral });
}

async function adminRipristina(ctx: BotContext): Promise<void> {
  if (!ctx.from || !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.adminOnly);
    return;
  }
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
    return;
  }

  const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
  const dealId = (parts[1] ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(dealId)) {
    await ctx.reply(it.ripristinaUsage, { parse_mode: "Markdown" });
    return;
  }

  const profile = getOrphanProfile(dealId);
  if (!profile) {
    await ctx.reply(it.ripristinaUnknown(dealId), { parse_mode: "Markdown" });
    return;
  }

  const boundOther = ctx.store.findByGroupChatId(ctx.chat.id);
  if (boundOther && boundOther.id !== dealId) {
    await ctx.reply(it.alreadyBound);
    return;
  }

  const master = await getMasterKeypair();
  if (!master) {
    await ctx.reply(it.payoutFailed(
      { id: dealId } as Deal,
      "SOLANA_PRIVATE_KEY non configurata",
    ), { parse_mode: "Markdown" });
    return;
  }

  const derived = await deriveDealKeypair(master, dealId);
  const escrowAddress = derived.publicKey.toBase58();
  if (escrowAddress !== profile.escrowAddress) {
    await ctx.reply(it.ripristinaMismatch(dealId, profile.escrowAddress, escrowAddress), {
      parse_mode: "Markdown",
    });
    return;
  }

  let balance = 0n;
  try {
    balance = await getEscrowBalanceLamports(escrowAddress);
  } catch (err) {
    console.warn("ripristina balance check failed:", err);
  }

  const ts = new Date().toISOString();
  const existing = ctx.store.get(dealId);
  const deal: Deal = {
    id: dealId,
    creatorId: existing?.creatorId ?? 0,
    creatorUsername: existing?.creatorUsername,
    creatorRole: existing?.creatorRole ?? "seller",
    buyerId: existing?.buyerId,
    buyerUsername: existing?.buyerUsername,
    sellerId: existing?.sellerId,
    sellerUsername: existing?.sellerUsername,
    buyerWallet: profile.buyerWallet,
    sellerWallet: profile.sellerWallet,
    amount: profile.amount,
    asset: profile.asset,
    status: balance > 0n ? "funded" : existing?.status === "released" || existing?.status === "refunded"
      ? existing.status
      : "funded",
    escrowAddress,
    groupChatId: ctx.chat.id,
    releaseVotes: [],
    refundVotes: [],
    botPromptIds: [],
    depositLamports: balance > 0n ? String(balance) : existing?.depositLamports,
    depositDetectedAt: balance > 0n ? ts : existing?.depositDetectedAt,
    tosText: existing?.tosText ?? "[ripristinato] deal orfano dopo redeploy",
    tosAcceptedAt: existing?.tosAcceptedAt ?? ts,
    payoutTxSig: existing?.payoutTxSig,
    payoutCompleted: existing?.payoutCompleted,
    // Conserva attribuzione invito (fee 2.5% collab) se presente nello store
    inviteCode: existing?.inviteCode,
    collaboratorUserId: existing?.collaboratorUserId,
    collaboratorWallet: existing?.collaboratorWallet,
    platformFeeLamports: existing?.platformFeeLamports,
    collaboratorFeeLamports: existing?.collaboratorFeeLamports,
    sellerPayoutLamports: existing?.sellerPayoutLamports,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
  };

  const saved = ctx.store.upsert(deal);
  await ctx.reply(
    it.ripristinaOk(saved, lamportsToSolString(balance)),
    {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(saved.status, saved),
    },
  );
  if (saved.status === "funded" && !saved.sellerShippedAt) {
    await postShipAsk(ctx.api, ctx.store, saved);
  }
}

async function adminPayoutOrphan(ctx: BotContext): Promise<void> {
  if (!ctx.from || !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.adminOnly);
    return;
  }

  const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
  const dealId = (parts[1] ?? "").trim().toLowerCase();
  const who = (parts[2] ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{8}$/.test(dealId) || (who !== "seller" && who !== "buyer")) {
    await ctx.reply(it.adminPayoutUsage, { parse_mode: "Markdown" });
    return;
  }

  const profile = getOrphanProfile(dealId);
  const fromStore = ctx.store.get(dealId);
  const dest =
    who === "seller"
      ? profile?.sellerWallet ?? fromStore?.sellerWallet
      : profile?.buyerWallet ?? fromStore?.buyerWallet;

  if (!dest) {
    await ctx.reply(it.needWallet(who === "seller" ? "seller" : "buyer"), {
      parse_mode: "Markdown",
    });
    return;
  }

  if (profile) {
    const master = await getMasterKeypair();
    if (!master) {
      await ctx.reply("SOLANA_PRIVATE_KEY non configurata.");
      return;
    }
    const derived = await deriveDealKeypair(master, dealId);
    if (derived.publicKey.toBase58() !== profile.escrowAddress) {
      await ctx.reply(
        it.ripristinaMismatch(
          dealId,
          profile.escrowAddress,
          derived.publicKey.toBase58(),
        ),
        { parse_mode: "Markdown" },
      );
      return;
    }
  }

  const kind = who === "seller" ? "release" : "refund";
  const live = ctx.store.get(dealId) ?? fromStore;
  if (
    live?.payoutCompleted ||
    (live?.payoutTxSig &&
      (live.status === "released" || live.status === "refunded"))
  ) {
    await ctx.reply(it.payoutAlreadyDone(live), { parse_mode: "Markdown" });
    return;
  }

  if (payoutInFlight.has(dealId)) {
    await ctx.reply(it.payoutBusy({ id: dealId } as Deal), {
      parse_mode: "Markdown",
    });
    return;
  }

  await ctx.reply(
    who === "seller"
      ? it.adminForceRelease({ id: dealId } as Deal)
      : it.adminForceRefund({ id: dealId } as Deal),
    { parse_mode: "Markdown" },
  );

  payoutInFlight.add(dealId);
  try {
    const result = await payoutDealSol(dealId, dest, {
      kind,
      collaboratorWallet:
        kind === "release" ? live?.collaboratorWallet : undefined,
    });
    if (!result.ok) {
      if (result.errorCode === "empty_escrow") {
        const escrowAddr =
          live?.escrowAddress ?? profile?.escrowAddress ?? undefined;
        const bal = escrowAddr
          ? await getEscrowBalanceLamports(escrowAddr).catch(() => 0n)
          : 0n;
        if (bal === 0n && live) {
          const reconciled = await reconcileEmptyEscrow(ctx, live, kind);
          await ctx.reply(it.payoutReconciledEmpty(reconciled), {
            parse_mode: "Markdown",
          });
          return;
        }
      }
      await ctx.reply(it.payoutFailed({ id: dealId } as Deal, result.error), {
        parse_mode: "Markdown",
      });
      return;
    }

    let updated: Deal | undefined;
    if (live || ctx.store.get(dealId)) {
      updated = markPayoutCompleted(ctx, dealId, kind, result);
    }

    await ctx.reply(
      it.payoutSuccess(
        updated ??
          ({
            id: dealId,
            sellerWallet: who === "seller" ? dest : live?.sellerWallet,
            buyerWallet: who === "buyer" ? dest : live?.buyerWallet,
            sellerUsername: live?.sellerUsername,
            buyerUsername: live?.buyerUsername,
            priceEur: live?.priceEur,
            collaboratorWallet: live?.collaboratorWallet,
          } as Deal),
        kind,
        result.signature,
        result.sol,
        {
          platformFeeSol:
            result.platformFeeLamports != null
              ? lamportsToSolString(result.platformFeeLamports)
              : undefined,
          collaboratorFeeSol:
            result.collaboratorFeeLamports != null &&
            result.collaboratorFeeLamports > 0n
              ? lamportsToSolString(result.collaboratorFeeLamports)
              : undefined,
          feeWallet: result.feeWallet,
          collaboratorWallet: result.collaboratorWallet,
        },
      ),
      {
        parse_mode: "Markdown",
        reply_markup: payoutHashKeyboard(),
      },
    );
  } catch (err) {
    const classified = classifyPayoutError(err);
    console.error(
      `admin_payout #${dealId} kind=${kind} uncaught: ${classified.code} — ${classified.message}`,
      err instanceof Error ? err.message : err,
    );
    try {
      await ctx.reply(
        it.payoutFailed({ id: dealId } as Deal, classified.message),
        { parse_mode: "Markdown" },
      );
    } catch (replyErr) {
      console.error(
        `admin_payout #${dealId} fail-reply also failed:`,
        replyErr instanceof Error ? replyErr.message : replyErr,
      );
    }
  } finally {
    payoutInFlight.delete(dealId);
  }
}
