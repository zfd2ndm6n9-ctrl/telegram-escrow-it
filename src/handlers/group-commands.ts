import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import { groupActionsKeyboard, mainMenuKeyboard } from "../keyboards/menus.js";
import {
  addUniqueVote,
  isAdminUser,
  isParty,
  isPreDepositSetup,
} from "../services/deal-logic.js";
import { createAdminInviteLink, postAskBuyerWallet, postDealActivated } from "../services/group-setup.js";
import {
  checkDealDeposit,
  isValidSolAddress,
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
    await ctx.reply(it.depositAddress(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
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
    await ctx.reply(formatStato(deal), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
  });

  bot.command("pay_seller", async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  /** Alias CoinXpert-style */
  bot.command("release", async (ctx) => {
    await handlePayOrRefund(ctx, "release");
  });

  bot.command("refund_buyer", async (ctx) => {
    await handlePayOrRefund(ctx, "refund");
  });

  bot.command("dispute", async (ctx) => {
    await openDispute(ctx);
  });

  bot.command("support", async (ctx) => {
    await replySupport(ctx);
  });

  bot.command("menu", async (ctx) => {
    await replyMenu(ctx);
  });

  bot.command("blockchain", async (ctx) => {
    await replyBlockchain(ctx);
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
    await ctx.reply(it.depositAddress(deal), { parse_mode: "Markdown" });
  });

  bot.callbackQuery("funded", async (ctx) => {
    await ctx.answerCallbackQuery();
    await verifyDeposit(ctx);
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
    await openDispute(ctx);
  });

  bot.callbackQuery("stato", async (ctx) => {
    const deal = requireGroupDeal(ctx);
    if (!deal) {
      await ctx.answerCallbackQuery({ text: "Nessun deal" });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.reply(formatStato(deal), { parse_mode: "Markdown" });
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

function formatStato(deal: Deal): string {
  return `*Deal #${deal.id}*
• Stato: \`${deal.status}\`
• Importo: *${deal.amount} ${deal.asset}*
• Buyer: ${deal.buyerId ?? "—"} · \`${deal.buyerWallet ?? "wallet?"}\`
• Seller: ${deal.sellerId ?? "—"} · \`${deal.sellerWallet ?? "wallet?"}\`
• ToS: ${deal.tosAcceptedAt ? "accettati" : deal.tosText ? "in conferma" : "—"}
• Escrow: \`${deal.escrowAddress}\`
• Deposit lamports: ${deal.depositLamports ?? "—"}
• Payout tx: ${deal.payoutTxSig ? `\`${deal.payoutTxSig}\`` : "—"}`;
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
    await ctx.reply(`Uso: \`/wallet IndirizzoSolana\`\n${it.invalidWallet}`, {
      parse_mode: "Markdown",
    });
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

  const isBuyer = deal.buyerId === ctx.from.id;
  const isSeller = deal.sellerId === ctx.from.id;
  if (!isBuyer && !isSeller) {
    await ctx.reply(it.notParty);
    return;
  }

  // Dopo ToS: ordine fisso seller → buyer
  if (deal.status === "awaiting_seller_wallet") {
    if (!isSeller) {
      await ctx.reply(it.walletWrongTurn("seller"), { parse_mode: "Markdown" });
      return;
    }
    const updated = ctx.store.update(deal.id, {
      sellerWallet: address,
      status: "awaiting_buyer_wallet",
    })!;
    await ctx.reply(it.walletSaved(updated, "seller", address), {
      parse_mode: "Markdown",
    });
    await postAskBuyerWallet(ctx.api, updated);
    return;
  }

  if (deal.status === "awaiting_buyer_wallet") {
    if (!isBuyer) {
      await ctx.reply(it.walletWrongTurn("buyer"), { parse_mode: "Markdown" });
      return;
    }
    const updated = ctx.store.update(deal.id, {
      buyerWallet: address,
      status: "awaiting_deposit",
    })!;
    await ctx.reply(it.walletSaved(updated, "buyer", address), {
      parse_mode: "Markdown",
    });
    await postDealActivated(ctx.api, updated);
    return;
  }

  // Stati successivi: permette update wallet propria parte senza cambiare status
  if (isPreDepositSetup(deal.status)) {
    await ctx.reply(it.wrongStatus(deal.status), { parse_mode: "Markdown" });
    return;
  }

  const patch: Partial<Deal> = {};
  let role: "buyer" | "seller";
  if (isBuyer) {
    patch.buyerWallet = address;
    role = "buyer";
  } else {
    patch.sellerWallet = address;
    role = "seller";
  }
  const updated = ctx.store.update(deal.id, patch)!;
  await ctx.reply(it.walletSaved(updated, role, address), {
    parse_mode: "Markdown",
  });
}

async function verifyDeposit(ctx: BotContext): Promise<void> {
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

  // Admin: /depositato force → bypass on-chain (emergenza)
  const raw = ctx.message?.text ?? "";
  if (
    isAdminUser(ctx.from.id) &&
    deal.status === "awaiting_deposit" &&
    /\bforce\b/i.test(raw)
  ) {
    const updated = ctx.store.setStatus(deal.id, "funded")!;
    await ctx.reply(it.markFundedAdmin(updated), { parse_mode: "Markdown" });
    return;
  }

  if (deal.status !== "awaiting_deposit" && deal.status !== "funded") {
    await ctx.reply(it.wrongStatus(deal.status));
    return;
  }

  const result = await checkDealDeposit(ctx.store, deal.id);
  if (!result.ok) {
    await ctx.reply(`Verifica deposito fallita: \`${result.error}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  const fresh = ctx.store.get(deal.id)!;
  await ctx.reply(
    it.depositCheckResult(fresh, result.balanceSol, result.funded),
    {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(fresh.status),
    },
  );
}

async function runPayout(
  ctx: BotContext,
  deal: Deal,
  kind: "release" | "refund",
): Promise<void> {
  const dest = kind === "release" ? deal.sellerWallet : deal.buyerWallet;
  const who = kind === "release" ? "seller" : "buyer";
  if (!dest) {
    await ctx.reply(it.needWallet(who), { parse_mode: "Markdown" });
    return;
  }

  await ctx.reply(
    kind === "release" ? it.releaseVote(deal, 0) : it.refundVote(deal, 0),
    { parse_mode: "Markdown" },
  );

  const result = await payoutDealSol(deal.id, dest);
  if (!result.ok) {
    await ctx.reply(it.payoutFailed(deal, result.error), {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(deal.status),
    });
    return;
  }

  const doneStatus = kind === "release" ? "released" : "refunded";
  const updated = ctx.store.update(deal.id, {
    status: doneStatus,
    payoutTxSig: result.signature,
  })!;

  await ctx.reply(
    it.payoutSuccess(updated, kind, result.signature, result.sol),
    { parse_mode: "Markdown" },
  );
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

  const voteKey = kind === "release" ? "releaseVotes" : "refundVotes";
  const votes = addUniqueVote(deal[voteKey], ctx.from.id);
  const pendingStatus = kind === "release" ? "release_pending" : "refund_pending";
  const done = votes.length >= 2;

  const pending = ctx.store.update(deal.id, {
    [voteKey]: votes,
    status: pendingStatus,
  })!;

  if (!done) {
    const remaining = Math.max(0, 2 - votes.length);
    const msg =
      kind === "release"
        ? it.releaseVote(pending, remaining)
        : it.refundVote(pending, remaining);
    await ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: groupActionsKeyboard(pending.status),
    });
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

async function replyMenu(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type === "private") {
    await ctx.reply(it.menuDm, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  const deal = requireGroupDeal(ctx);
  if (!deal) {
    await ctx.reply(it.menuGroup, { parse_mode: "Markdown" });
    return;
  }
  await ctx.reply(it.menuGroup, {
    parse_mode: "Markdown",
    reply_markup: groupActionsKeyboard(deal.status),
  });
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

export async function openDispute(ctx: BotContext): Promise<void> {
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

  await ctx.reply(it.disputeOpened(updated), { parse_mode: "Markdown" });

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
