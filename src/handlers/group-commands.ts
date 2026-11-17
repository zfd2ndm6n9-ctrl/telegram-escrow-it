import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { formatDealStatus, it } from "../messages/it.js";
import { groupActionsKeyboard } from "../keyboards/menus.js";
import {
  addUniqueVote,
  isAdminUser,
  isParty,
  isPreDepositSetup,
} from "../services/deal-logic.js";
import {
  createAdminInviteLink,
  postAskBuyerWallet,
  postDealActivated,
} from "../services/group-setup.js";
import {
  clearBotPrompts,
  clearEphemeralReplies,
  replaceActionReply,
  replaceStatusMessage,
} from "../services/prompt-cleanup.js";
import { getOrphanProfile } from "../services/orphan-profiles.js";
import {
  checkDealDeposit,
  deriveDealKeypair,
  getEscrowBalanceLamports,
  getMasterKeypair,
  isValidSolAddress,
  lamportsToSolString,
  payoutDealSol,
} from "../services/solana/index.js";
import type { Deal } from "../types.js";

function requireGroupDeal(ctx: BotContext): Deal | null {
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    return null;
  }
  return ctx.store.findByGroupChatId(ctx.chat.id) ?? null;
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

export function registerGroupCommandHandlers(bot: Bot<BotContext>): void {
  bot.command("indirizzo", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      if (ctx.chat?.type === "private") {
        await ctx.reply(it.onlyGroup, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(it.noDealInGroup);
      }
      return;
    }
    if (!depositUnlocked(deal)) {
      await ctx.reply(it.notReadyForDeposit);
      return;
    }
    await replaceActionReply(ctx.api, ctx.store, deal, it.depositAddress(deal), {
      parse_mode: "Markdown",
    });
  });

  bot.command("depositato", async (ctx) => {
    await verifyDeposit(ctx);
  });

  bot.command("wallet", async (ctx) => {
    await setWallet(ctx);
  });

  bot.command("stato", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.reply(it.noDealInGroup);
      return;
    }
    await replaceStatusMessage(ctx.api, ctx.store, deal, formatDealStatus(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
  });

  bot.command(["pay_seller", "payseller", "release"], async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  bot.command(["refund_buyer", "refundbuyer"], async (ctx) => {
    await handlePayOrRefund(ctx, "refund");
  });

  bot.command("dispute", async (ctx) => {
    await openDispute(ctx);
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
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    if (!depositUnlocked(deal)) {
      await ctx.answerCallbackQuery({ text: "Non ancora" });
      await ctx.reply(it.notReadyForDeposit);
      return;
    }
    await ctx.answerCallbackQuery();
    // Sostituisce verifica/stato/disputa precedenti: resta solo Indirizzo escrow.
    await replaceActionReply(ctx.api, ctx.store, deal, it.depositAddress(deal), {
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery("funded", async (ctx) => {
    await ctx.answerCallbackQuery();
    await verifyDeposit(ctx, { ephemeral: true });
  });

  bot.callbackQuery("pay_seller", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePayOrRefund(ctx, "release");
  });

  bot.callbackQuery("refund_buyer", async (ctx) => {
    await ctx.answerCallbackQuery();
    await handlePayOrRefund(ctx, "refund");
  });

  bot.callbackQuery("dispute", async (ctx) => {
    await ctx.answerCallbackQuery();
    await openDispute(ctx, { ephemeral: true });
  });

  bot.callbackQuery("stato", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    await ctx.answerCallbackQuery();
    await replaceStatusMessage(ctx.api, ctx.store, deal, formatDealStatus(deal), {
      parse_mode: "Markdown",
    });
  });

  // Incolla wallet in chiaro durante awaiting_*_wallet
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
    const deal = requireGroupDeal(ctx);
    if (
      !deal ||
      !ctx.from ||
      (deal.status !== "awaiting_seller_wallet" &&
        deal.status !== "awaiting_buyer_wallet")
    ) {
      await next();
      return;
    }
    if (!isValidSolAddress(text)) {
      await next();
      return;
    }
    await applyWallet(ctx, deal, text);
  });
}

async function setWallet(ctx: BotContext): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  const text = ctx.message?.text ?? "";
  const parts = text.trim().split(/\s+/);
  const address = parts.length >= 2 ? parts.slice(1).join("").trim() : "";
  if (!address || !isValidSolAddress(address)) {
    await ctx.reply(
      `Uso: \`/wallet\` seguito dall'indirizzo.\n${it.invalidWallet}`,
      {
        parse_mode: "Markdown",
      },
    );
    return;
  }

  await applyWallet(ctx, deal, address);
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
    await ctx.reply(it.notParty);
    return;
  }

  // Dopo ToS: ordine fisso seller → buyer
  if (deal.status === "awaiting_seller_wallet") {
    if (!isSeller) {
      await ctx.reply(it.walletWrongTurn(deal, "seller"), {
        parse_mode: "Markdown",
      });
      return;
    }
    const updated = ctx.store.update(deal.id, {
      sellerWallet: address,
      status: "awaiting_buyer_wallet",
    })!;
    await ctx.reply(it.walletSaved(updated, "seller", address), {
      parse_mode: "Markdown",
    });
    await postAskBuyerWallet(ctx.api, ctx.store, updated);
    return;
  }

  if (deal.status === "awaiting_buyer_wallet") {
    if (!isBuyer) {
      await ctx.reply(it.walletWrongTurn(deal, "buyer"), {
        parse_mode: "Markdown",
      });
      return;
    }
    const updated = ctx.store.update(deal.id, {
      buyerWallet: address,
      status: "awaiting_deposit",
    })!;
    await ctx.reply(it.walletSaved(updated, "buyer", address), {
      parse_mode: "Markdown",
    });
    await postDealActivated(ctx.api, ctx.store, updated);
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
    await ctx.reply(it.walletLockedAfterDeposit(deal), {
      parse_mode: "Markdown",
    });
    return;
  }

  if (isPreDepositSetup(deal.status)) {
    await ctx.reply(it.wrongStatus(deal.status), { parse_mode: "Markdown" });
    return;
  }

  await ctx.reply(it.wrongStatus(deal.status), { parse_mode: "Markdown" });
}

async function verifyDeposit(
  ctx: BotContext,
  opts?: { ephemeral?: boolean },
): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  if (isPreDepositSetup(deal.status) || deal.status === "awaiting_counterpart") {
    await ctx.reply(it.notReadyForDeposit);
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
        ? { reply_markup: groupActionsKeyboard(current.status) }
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
    let updated = ctx.store.setStatus(deal.id, "funded")!;
    updated = await clearBotPrompts(ctx.api, ctx.store, updated);
    await replyResult(updated, it.markFundedAdmin(updated), true);
    return;
  }

  if (deal.status !== "awaiting_deposit" && deal.status !== "funded") {
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }

  const wasAwaiting = deal.status === "awaiting_deposit";
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
  if (wasAwaiting && result.funded) {
    fresh = await clearBotPrompts(ctx.api, ctx.store, fresh);
  }
  await replyResult(
    fresh,
    it.depositCheckResult(fresh, result.balanceSol, result.funded),
    true,
  );
}

/** Lock in-process: evita doppio sendAndConfirm concorrente sullo stesso deal. */
const payoutInFlight = new Set<string>();

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
  return ctx.store.update(dealId, {
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
  return updated;
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
  try {
    await ctx.reply(
      kind === "release" ? it.releaseVote(fresh, 0) : it.refundVote(fresh, 0),
      { parse_mode: "Markdown" },
    );

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
        reply_markup: groupActionsKeyboard(fresh.status),
      });
      return;
    }

    let updated = markPayoutCompleted(ctx, fresh.id, kind, result)!;
    updated = await clearBotPrompts(ctx.api, ctx.store, updated);

    await ctx.reply(
      it.payoutSuccess(updated, kind, result.signature, result.sol, {
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
      }),
      { parse_mode: "Markdown" },
    );
  } finally {
    payoutInFlight.delete(fresh.id);
  }
}

async function handlePayOrRefund(
  ctx: BotContext,
  kind: "release" | "refund",
): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }

  if (deal.status === "disputed" && isAdminUser(ctx.from.id)) {
    await runPayout(ctx, deal, kind);
    return;
  }

  if (!isParty(deal, ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  if (!deal.buyerId || !deal.sellerId) {
    await ctx.reply("Mancano ancora buyer o seller nel deal.");
    return;
  }

  // Conflitto verso opposto: release_pending ≠ refund e viceversa
  if (
    (kind === "release" && deal.status === "refund_pending") ||
    (kind === "refund" && deal.status === "release_pending")
  ) {
    await ctx.reply(
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
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }

  const dest = kind === "release" ? deal.sellerWallet : deal.buyerWallet;
  if (!dest) {
    await ctx.reply(it.needWallet(kind === "release" ? "seller" : "buyer"), {
      parse_mode: "Markdown",
    });
    return;
  }

  // Merge voto sul record fresco (sync get→update: no await in mezzo)
  const latest = ctx.store.get(deal.id) ?? deal;
  if (
    latest.payoutCompleted ||
    latest.status === "released" ||
    latest.status === "refunded"
  ) {
    await ctx.reply(it.payoutAlreadyDone(latest), { parse_mode: "Markdown" });
    return;
  }
  if (
    (kind === "release" && latest.status === "refund_pending") ||
    (kind === "refund" && latest.status === "release_pending")
  ) {
    await ctx.reply(
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
    await ctx.reply(it.wrongStatus(latest.status));
    return;
  }

  const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
  const prevVotes = latest[voteKey];
  if (prevVotes.includes(ctx.from.id)) {
    await ctx.reply(it.alreadyVoted(latest, kind), { parse_mode: "Markdown" });
    return;
  }
  const votes = addUniqueVote(prevVotes, ctx.from.id);
  const pendingStatus = kind === "release" ? "release_pending" : "refund_pending";
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
    // Togli prompt con tastiere pay_seller accumulate; conferma 1/2 senza nuovi bottoni.
    await clearBotPrompts(ctx.api, ctx.store, pending);
    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  await runPayout(ctx, pending, kind);
}

async function replySupport(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type === "private") {
    await ctx.reply(it.supportDm, { parse_mode: "Markdown" });
    return;
  }
  const deal = requireGroupDeal(ctx);
  if (!deal) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  await ctx.reply(it.supportGroup, { parse_mode: "Markdown" });
}

async function replyBlockchain(ctx: BotContext): Promise<void> {
  const deal = requireGroupDeal(ctx);
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

export async function openDispute(
  ctx: BotContext,
  opts?: { ephemeral?: boolean },
): Promise<void> {
  const deal = requireGroupDeal(ctx);
  if (!deal || !ctx.from) {
    await ctx.reply(it.noDealInGroup);
    return;
  }
  if (!isParty(deal, ctx.from.id) && !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.notParty);
    return;
  }

  if (deal.groupChatId == null) {
    await ctx.reply(it.noDealInGroup);
    return;
  }

  let adminLink = deal.adminInviteLink;
  if (!adminLink) {
    adminLink = await createAdminInviteLink(ctx.api, deal.groupChatId, deal.id);
  }

  const updated = ctx.store.update(deal.id, {
    status: "disputed",
    adminInviteLink: adminLink,
  })!;

  const opened = it.disputeOpened(updated);
  if (opts?.ephemeral) {
    await replaceActionReply(ctx.api, ctx.store, updated, opened, {
      parse_mode: "Markdown",
    });
  } else {
    await clearEphemeralReplies(ctx.api, ctx.store, updated);
    await ctx.reply(opened, { parse_mode: "Markdown" });
  }

  if (!config.adminTelegramId) {
    await ctx.reply(it.adminMissing);
    return;
  }

  try {
    await ctx.api.sendMessage(
      config.adminTelegramId,
      it.disputeAdminNotify(
        updated,
        ctx.from.id,
        ctx.from.username,
        adminLink,
      ),
    );
  } catch (err) {
    console.error("Notifica admin fallita:", err);
    await ctx.reply(
      "Disputa aperta ma non riesco a scrivere all'admin in privato (deve aver avviato il bot).",
    );
  }
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
      reply_markup: groupActionsKeyboard(saved.status),
    },
  );
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
      { parse_mode: "Markdown" },
    );
  } finally {
    payoutInFlight.delete(dealId);
  }
}
