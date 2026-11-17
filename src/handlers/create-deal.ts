import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import {
  afterAmountKeyboard,
  assetKeyboard,
  groupInviteKeyboard,
  mainMenuKeyboard,
  roleKeyboard,
} from "../keyboards/menus.js";
import {
  nextDmTermsStep,
  startGroupPayload,
  termsReadyForConfirm,
} from "../services/deal-logic.js";
import {
  applySellerTermsAnswer,
  findOpenSellerTermsDeal,
  startSellerTermsWizard,
} from "../services/dm-terms.js";
import {
  createEscrowGroup,
  groupCreatorReady,
} from "../services/group-creator.js";
import {
  refreshGroupSetupCard,
  startDealInGroup,
} from "../services/group-setup.js";
import {
  getDealEscrowAddress,
  isSolanaConfigured,
  isValidSolAddress,
} from "../services/solana/index.js";
import { requireRegistered } from "../services/registration.js";
import { dismissInviteStep } from "./start.js";
import type { Asset, PartyRole } from "../types.js";

function botCreatesGroupsEnabled(): boolean {
  return config.telegramBotCreatesGroups && groupCreatorReady();
}

function startGroupUrlForDeal(dealId: string, ctx: BotContext): string {
  const username = config.botUsername ?? ctx.botUsername ?? "ESCROWITAbot";
  return `https://t.me/${username}?startgroup=${startGroupPayload(dealId)}`;
}

export function registerCreateDealHandlers(bot: Bot<BotContext>): void {
  const beginCreate = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.onlyPrivate, { parse_mode: "Markdown" });
      return;
    }
    if (!(await requireRegistered(ctx))) return;
    if (!isSolanaConfigured()) {
      await ctx.reply(it.solanaNotConfigured);
      return;
    }
    // Invito opzionale: non bloccare /crea; chiudi prompt senza stack
    await dismissInviteStep(ctx);
    ctx.session.creating = { step: "role" };
    ctx.session.termsQa = undefined;
    await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
  };

  bot.command("crea", beginCreate);
  bot.command("create", beginCreate);
  bot.hears("➕ Crea escrow", beginCreate);

  bot.hears("❌ Annulla", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    const termsQa = ctx.session.termsQa;
    if (termsQa) {
      const deal = ctx.store.get(termsQa.dealId);
      if (deal && deal.status === "awaiting_group" && !deal.groupChatId) {
        ctx.store.setStatus(deal.id, "cancelled");
      }
    }
    ctx.session.creating = undefined;
    ctx.session.termsQa = undefined;
    await ctx.reply(it.cancelled, { reply_markup: mainMenuKeyboard() });
  });

  bot.hears("🛒 Sono il buyer", async (ctx) => {
    await pickRole(ctx, "buyer");
  });

  bot.hears("🏪 Sono il seller", async (ctx) => {
    await pickRole(ctx, "seller");
  });

  bot.hears("◎ SOL", async (ctx) => {
    await pickAsset(ctx, "SOL");
  });

  bot.hears("ETH (presto)", async (ctx) => {
    await assetComingSoon(ctx, "ETH");
  });

  bot.hears("LTC (presto)", async (ctx) => {
    await assetComingSoon(ctx, "LTC");
  });

  bot.callbackQuery("tos", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "ToS in arrivo" });
    await ctx.reply(it.tosComingSoon, { parse_mode: "Markdown" });
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    // Wizard termini seller (session o deal aperto)
    const termsHandled = await handlePrivateTermsReply(ctx, text);
    if (termsHandled) return;

    const creating = ctx.session.creating;
    if (!creating || !ctx.from) {
      await next();
      return;
    }

    if (creating.step === "role") {
      await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
      return;
    }

    if (creating.step === "asset") {
      await ctx.reply(it.askAsset, { reply_markup: assetKeyboard() });
      return;
    }

    await next();
  });
}

async function handlePrivateTermsReply(
  ctx: BotContext,
  text: string,
): Promise<boolean> {
  if (!ctx.from || ctx.chat?.type !== "private") return false;

  let dealId = ctx.session.termsQa?.dealId;
  let step = ctx.session.termsQa?.step;

  if (!dealId || !step) {
    const open = findOpenSellerTermsDeal(ctx.store, ctx.from.id);
    if (!open) return false;
    const next = nextDmTermsStep(open);
    if (!next) return false;
    dealId = open.id;
    step = next;
    ctx.session.termsQa = { dealId, step };
  }

  const deal = ctx.store.get(dealId);
  if (!deal || deal.sellerId !== ctx.from.id) {
    ctx.session.termsQa = undefined;
    return false;
  }

  // Gate soft signup solo se il seller è l'opener del deal.
  // Controparte seller (buyer ha aperto): termini OK senza /start + @.
  if (
    deal.creatorId === ctx.from.id &&
    !(await requireRegistered(ctx))
  ) {
    ctx.session.termsQa = undefined;
    return true;
  }
  if (termsReadyForConfirm(deal) || deal.status === "cancelled") {
    ctx.session.termsQa = undefined;
    return false;
  }

  const result = await applySellerTermsAnswer(
    ctx.api,
    ctx.store,
    deal,
    ctx.chat.id,
    ctx.from.id,
    step,
    text,
    ctx.message?.message_id,
  );

  if (!result.ok) {
    if (result.reason === "price") {
      await ctx.reply(it.dmTermsInvalidPrice, { parse_mode: "Markdown" });
    } else if (result.reason === "short" || result.reason === "empty") {
      await ctx.reply(it.dmTermsTooShort, { parse_mode: "Markdown" });
    }
    return true;
  }

  if (!result.done && result.nextStep) {
    ctx.session.termsQa = { dealId, step: result.nextStep };
    return true;
  }

  // Completo — un solo messaggio in DM (niente overlap Termini salvati + Deal pronto)
  ctx.session.termsQa = undefined;

  if (result.deal.groupChatId != null) {
    await ctx.reply(it.dmTermsComplete(result.deal), {
      parse_mode: "Markdown",
    });
    await refreshGroupSetupCard(ctx.api, ctx.store, result.deal);
  } else if (result.deal.creatorId === ctx.from.id) {
    // Seller opener: solo istruzioni gruppo (già «Termini già compilati»)
    await finishDealReady(ctx, result.deal);
  } else {
    await ctx.reply(it.dmTermsComplete(result.deal), {
      parse_mode: "Markdown",
    });
  }

  return true;
}

async function pickRole(ctx: BotContext, role: PartyRole): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  if (!ctx.session.creating || ctx.session.creating.step !== "role") {
    ctx.session.creating = { step: "role" };
  }
  ctx.session.creating = { step: "asset", role };
  await ctx.reply(it.askAsset, { reply_markup: assetKeyboard() });
}

async function pickAsset(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset" || !creating.role) {
    ctx.session.creating = { step: "role" };
    await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
    return;
  }

  if (asset !== "SOL") {
    await assetComingSoon(ctx, asset);
    return;
  }

  const role = creating.role;
  const placeholder = "PENDING_SOL_ESCROW";
  const creatorDisplayName = [ctx.from.first_name, ctx.from.last_name]
    .filter(Boolean)
    .join(" ");

  // Attribuzione invito: codice del creator → snapshot sul deal
  const inviteAttribution = resolveCreatorInvite(ctx);

  const deal = ctx.store.create({
    creatorId: ctx.from.id,
    creatorUsername: ctx.from.username,
    creatorDisplayName: creatorDisplayName || undefined,
    creatorRole: role,
    amount: "",
    asset,
    escrowAddress: placeholder,
    ...inviteAttribution,
  });

  const escrowAddress = await getDealEscrowAddress(deal.id);
  if (!escrowAddress) {
    ctx.store.setStatus(deal.id, "cancelled");
    ctx.session.creating = undefined;
    await ctx.reply(it.solanaNotConfigured);
    return;
  }

  const updated = ctx.store.update(deal.id, { escrowAddress })!;
  ctx.session.creating = undefined;

  // Seller opener: 3 domande termini prima delle istruzioni gruppo
  if (role === "seller") {
    const started = await startSellerTermsWizard(ctx.api, ctx.store, updated);
    if (started.ok && !started.alreadyReady) {
      ctx.session.termsQa = {
        dealId: started.deal.id,
        step: nextDmTermsStep(started.deal) ?? "product",
      };
      return;
    }
    if (started.ok && started.alreadyReady) {
      await finishDealReady(ctx, started.deal);
      return;
    }
    // dm_blocked non dovrebbe succedere in DM col creator — fallback istruzioni
    await finishDealReady(ctx, updated);
    return;
  }

  // Buyer opener: termini dopo /avvia (DM al seller)
  await finishDealReady(ctx, updated);
}

async function finishDealReady(
  ctx: BotContext,
  deal: Awaited<ReturnType<BotContext["store"]["create"]>>,
): Promise<void> {
  if (!ctx.from) return;

  // Opzionale: TELEGRAM_BOT_CREATES_GROUPS=1 + helper MTProto.
  if (botCreatesGroupsEnabled()) {
    const created = await createEscrowGroup({
      deal,
      botApi: ctx.api,
      creatorId: ctx.from.id,
      creatorUsername: ctx.from.username,
    });

    if (created.ok) {
      const withGroup =
        ctx.store.update(deal.id, {
          groupChatId: created.chatId,
          groupInviteLink: created.inviteLink,
        }) ?? deal;

      const { deal: started, perms } = await startDealInGroup(
        ctx.api,
        ctx.store,
        withGroup,
        created.chatId,
      );

      if (!perms.ok) {
        await ctx.reply(
          it.missingBotPerms(perms.missing, { notAdmin: perms.notAdmin }),
          {
            parse_mode: "Markdown",
            reply_markup: groupInviteKeyboard(
              created.inviteLink,
              config.tosUrl,
            ),
          },
        );
        return;
      }

      await ctx.reply(
        it.groupReady(started, created.inviteLink, created.creatorInvited),
        {
          parse_mode: "Markdown",
          reply_markup: groupInviteKeyboard(
            created.inviteLink,
            config.tosUrl,
          ),
        },
      );
      return;
    }

    // Soft-fallback: istruzioni manuali se create automatica fallisce.
    await ctx.reply(it.afterAmountInstructions(deal), {
      parse_mode: "Markdown",
      reply_markup: afterAmountKeyboard(
        startGroupUrlForDeal(deal.id, ctx),
        config.tosUrl,
      ),
    });
    await ctx.reply(it.groupCreateFailed(deal, created.error), {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  // Path felice (default): gruppo manuale — importo si fissa nel gruppo.
  await ctx.reply(it.afterAmountInstructions(deal), {
    parse_mode: "Markdown",
    reply_markup: afterAmountKeyboard(
      startGroupUrlForDeal(deal.id, ctx),
      config.tosUrl,
    ),
  });
}

async function assetComingSoon(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset") {
    return;
  }
  await ctx.reply(it.assetComingSoon(asset), {
    parse_mode: "Markdown",
    reply_markup: assetKeyboard(),
  });
}

/** Snapshot invito del creator sul deal (fee 2.5% collaboratore alla release). */
function resolveCreatorInvite(ctx: BotContext): {
  inviteCode?: string;
  collaboratorUserId?: number;
  collaboratorWallet?: string;
} {
  if (!ctx.from) return {};
  const member = ctx.members.get(ctx.from.id);
  const code = member?.inviteCode;
  if (!code) return {};
  const invite = ctx.invites.get(code);
  // Solo wallet dall'InviteStore admin — mai da input utente / member fields
  if (!invite || !invite.active) {
    return {};
  }
  const wallet = invite.collaboratorWallet?.trim();
  if (!wallet || !isValidSolAddress(wallet)) {
    return {};
  }
  return {
    inviteCode: invite.code,
    collaboratorUserId: invite.collaboratorUserId,
    collaboratorWallet: wallet,
  };
}
