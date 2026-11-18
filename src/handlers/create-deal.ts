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
  applyTermsAnswer,
  clearDmTermsUi,
  findOpenTermsDeal,
  startTermsWizard,
} from "../services/dm-terms.js";
import { groupBindExpiresAtIso } from "../services/group-bind-expiry.js";
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
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import { dismissInviteStep } from "./start.js";
import type { Asset, Deal, PartyRole } from "../types.js";

function botCreatesGroupsEnabled(): boolean {
  return config.telegramBotCreatesGroups && groupCreatorReady();
}

function startGroupUrlForDeal(dealId: string, ctx: BotContext): string {
  const username = config.botUsername ?? ctx.botUsername ?? "ESCROWITAbot";
  return `https://t.me/${username}?startgroup=${startGroupPayload(dealId)}`;
}

/** Igiene: cancella messaggi effimeri del wizard /crea (ruolo, crypto, risposte). */
async function clearCreatingEphemeral(ctx: BotContext): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  const ids = ctx.session.creatingEphemeralIds ?? [];
  for (const id of ids) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.creatingEphemeralIds = undefined;
}

function trackCreatingEphemeral(ctx: BotContext, messageId?: number): void {
  if (messageId == null) return;
  const prev = ctx.session.creatingEphemeralIds ?? [];
  ctx.session.creatingEphemeralIds = [...prev, messageId];
}

/** Come nel gruppo: cancella domanda precedente + risposta utente, poi nuovo prompt. */
async function replaceCreatingPrompt(
  ctx: BotContext,
  reply: () => Promise<{ message_id: number }>,
): Promise<void> {
  await clearCreatingEphemeral(ctx);
  if (ctx.chat?.type === "private" && ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }
  const ask = await reply();
  trackCreatingEphemeral(ctx, ask.message_id);
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
    await clearCreatingEphemeral(ctx);
    if (ctx.message?.message_id != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
    }
    ctx.session.creating = { step: "role" };
    ctx.session.termsQa = undefined;
    const ask = await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
    trackCreatingEphemeral(ctx, ask.message_id);
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
        await clearDmTermsUi(ctx.api, ctx.store, deal, ctx.chat.id);
        if (deal.dmGroupInstructionsMessageId != null) {
          await deleteMessageSafe(
            ctx.api,
            ctx.chat.id,
            deal.dmGroupInstructionsMessageId,
          );
          ctx.store.update(deal.id, {
            dmGroupInstructionsMessageId: undefined,
            awaitingGroupExpiresAt: undefined,
          });
        }
      }
    }
    await clearCreatingEphemeral(ctx);
    ctx.session.creating = undefined;
    ctx.session.termsQa = undefined;
    if (ctx.message?.message_id != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
    }
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
    await ctx.answerCallbackQuery({ text: "Termini Escrowita" });
    // Fallback se manca PUBLIC_BASE_URL (niente Mini App): una riga, non dump.
    await ctx.reply(it.tosFallback(config.tosWebAppUrl), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
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

    // Wizard termini proponente (session o deal aperto)
    const termsHandled = await handlePrivateTermsReply(ctx, text);
    if (termsHandled) return;

    const creating = ctx.session.creating;
    if (!creating || !ctx.from) {
      await next();
      return;
    }

    if (creating.step === "role") {
      await replaceCreatingPrompt(ctx, () =>
        ctx.reply(it.askRole, { reply_markup: roleKeyboard() }),
      );
      return;
    }

    if (creating.step === "asset") {
      await replaceCreatingPrompt(ctx, () =>
        ctx.reply(it.askAsset, { reply_markup: assetKeyboard() }),
      );
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
    const open = findOpenTermsDeal(ctx.store, ctx.from.id);
    if (!open) return false;
    const next = nextDmTermsStep(open);
    if (!next) return false;
    dealId = open.id;
    step = next;
    ctx.session.termsQa = { dealId, step };
  }

  const deal = ctx.store.get(dealId);
  if (!deal) {
    ctx.session.termsQa = undefined;
    return false;
  }

  const proposer = deal.tosProposedBy ?? deal.creatorId;
  if (proposer !== ctx.from.id) {
    ctx.session.termsQa = undefined;
    return false;
  }

  // Gate soft signup: wizard DM è solo per l'opener (/crea).
  if (
    deal.creatorId === ctx.from.id &&
    !(await requireRegistered(ctx))
  ) {
    ctx.session.termsQa = undefined;
    return true;
  }
  // Proponi i ToS risponde nel gruppo — ignora testo in DM mid-propose.
  if (deal.termsWizardInGroup) {
    ctx.session.termsQa = undefined;
    return false;
  }
  if (termsReadyForConfirm(deal) || deal.status === "cancelled") {
    ctx.session.termsQa = undefined;
    return false;
  }

  const result = await applyTermsAnswer(
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
    await clearDmTermsUi(ctx.api, ctx.store, result.deal, ctx.chat.id);
    await ctx.reply(it.dmTermsComplete(result.deal), {
      parse_mode: "Markdown",
    });
    await refreshGroupSetupCard(ctx.api, ctx.store, result.deal);
  } else if (result.deal.creatorId === ctx.from.id) {
    // Opener: istruzioni gruppo (termini già compilati)
    await finishDealReady(ctx, result.deal);
  } else {
    await clearDmTermsUi(ctx.api, ctx.store, result.deal, ctx.chat.id);
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
  await replaceCreatingPrompt(ctx, () =>
    ctx.reply(it.askAsset, { reply_markup: assetKeyboard() }),
  );
}

async function pickAsset(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset" || !creating.role) {
    ctx.session.creating = { step: "role" };
    await replaceCreatingPrompt(ctx, () =>
      ctx.reply(it.askRole, { reply_markup: roleKeyboard() }),
    );
    return;
  }

  if (asset !== "SOL") {
    await assetComingSoon(ctx, asset);
    return;
  }

  // Igiene: cancella ask crypto + risposta «◎ SOL» prima del wizard termini.
  await clearCreatingEphemeral(ctx);
  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
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

  // Opener (buyer o seller) = proponente termini: 3 domande subito
  const updated =
    ctx.store.update(deal.id, {
      escrowAddress,
      tosProposedBy: ctx.from.id,
    })!;
  ctx.session.creating = undefined;

  const started = await startTermsWizard(
    ctx.api,
    ctx.store,
    updated,
    ctx.from.id,
  );
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
}

async function finishDealReady(
  ctx: BotContext,
  deal: Deal,
): Promise<void> {
  if (!ctx.from || ctx.chat?.type !== "private") return;

  let current = await clearDmTermsUi(ctx.api, ctx.store, deal, ctx.chat.id);

  // Opzionale: TELEGRAM_BOT_CREATES_GROUPS=1 + helper MTProto.
  if (botCreatesGroupsEnabled()) {
    const created = await createEscrowGroup({
      deal: current,
      botApi: ctx.api,
      creatorId: ctx.from.id,
      creatorUsername: ctx.from.username,
    });

    if (created.ok) {
      const withGroup =
        ctx.store.update(current.id, {
          groupChatId: created.chatId,
          groupInviteLink: created.inviteLink,
          awaitingGroupExpiresAt: undefined,
          dmGroupInstructionsMessageId: undefined,
        }) ?? current;

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
              config.tosWebAppUrl,
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
            config.tosWebAppUrl,
          ),
        },
      );
      return;
    }

    // Soft-fallback: istruzioni manuali se create automatica fallisce.
    current = await sendGroupBindInstructions(ctx, current);
    await ctx.reply(it.groupCreateFailed(current, created.error), {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  // Path felice (default): gruppo manuale — importo si fissa nel gruppo.
  await sendGroupBindInstructions(ctx, current);
}

/** Istruzioni «aggiungi bot» + deadline 10 min + track message per igiene. */
async function sendGroupBindInstructions(
  ctx: BotContext,
  deal: Deal,
): Promise<Deal> {
  if (!ctx.chat || ctx.chat.type !== "private") return deal;
  const msg = await ctx.reply(it.afterAmountInstructions(deal), {
    parse_mode: "Markdown",
    reply_markup: afterAmountKeyboard(
      startGroupUrlForDeal(deal.id, ctx),
      config.tosWebAppUrl,
    ),
  });
  return (
    ctx.store.update(deal.id, {
      awaitingGroupExpiresAt: groupBindExpiresAtIso(),
      dmGroupInstructionsMessageId: msg.message_id,
    }) ?? deal
  );
}

async function assetComingSoon(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset") {
    return;
  }
  await replaceCreatingPrompt(ctx, () =>
    ctx.reply(it.assetComingSoon(asset), {
      parse_mode: "Markdown",
      reply_markup: assetKeyboard(),
    }),
  );
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
