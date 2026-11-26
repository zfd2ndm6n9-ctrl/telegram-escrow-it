import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import {
  afterAmountKeyboard,
  assetKeyboard,
  GROUP_READY_BACK_CB,
  groupInviteKeyboard,
  MAIN_MENU_CREA_CB,
  MAIN_MENU_CREA_LABEL,
  MAIN_MENU_MIEI_LABEL,
  mainMenuKeyboard,
  openBotDmKeyboard,
  roleKeyboard,
} from "../keyboards/menus.js";
import {
  isAdminUser,
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
  postHelperCounterpartInvite,
  refreshGroupSetupCard,
  startDealInGroup,
  type RequiredBotPerm,
} from "../services/group-setup.js";
import {
  getDealEscrowAddress,
  isSolanaConfigured,
} from "../services/solana/index.js";
import { requireRegistered } from "../services/registration.js";
import {
  cancelLeftoverCreaForNewFlow,
  cancelMidCreaBeforeGroupBind,
  clearCreatingEphemeral,
  clearTermsErrorMessages,
  replyWithMainMenu,
  trackCreatingEphemeral,
} from "../services/dm-hygiene.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import {
  askInviteOptional,
  clearInvitePrompt,
  completeInviteSkip,
  dismissInviteStep,
  lookupDealInvite,
  replyInviteAttachError,
} from "../services/invite-step.js";
import type { Asset, Deal, PartyRole } from "../types.js";

/** Pulsanti menu / wizard: non sono un codice invito né risposta termini. */
const MENU_TEXTS = new Set([
  MAIN_MENU_CREA_LABEL,
  MAIN_MENU_MIEI_LABEL,
  "❌ Annulla",
  "🛒 Sono il buyer",
  "🏪 Sono il seller",
  "◎ SOL",
  "ETH (presto)",
  "LTC (presto)",
]);

/** Legacy reply-keyboard labels (pre-inline clients): pass to hears below. */
const MAIN_MENU_TEXTS = new Set([MAIN_MENU_CREA_LABEL, MAIN_MENU_MIEI_LABEL]);

/** Prefer helper create whenever gate is on (default) and MTProto ready. */
function preferBotCreatedGroups(): boolean {
  return config.telegramBotCreatesGroups;
}

function botUsername(ctx: BotContext): string {
  return config.botUsername ?? ctx.botUsername ?? "ESCROWITAbot";
}

function startGroupUrlForDeal(dealId: string, ctx: BotContext): string {
  return `https://t.me/${botUsername(ctx)}?startgroup=${startGroupPayload(dealId)}`;
}

/**
 * DM post-create: testo con link + solo ← Indietro (niente Entra / Leggi Termini).
 * Fallback se Markdown fallisce — il link deve arrivare sempre.
 * Ritorna message_id per cancellarlo quando entra la controparte.
 */
async function replyCreatorInviteDm(
  ctx: BotContext,
  text: string,
  creatorLink: string,
): Promise<number | undefined> {
  if (!ctx.chat || ctx.chat.type !== "private") return undefined;

  const reply_markup = groupInviteKeyboard();

  try {
    const msg = await ctx.reply(text, { parse_mode: "Markdown", reply_markup });
    return msg.message_id;
  } catch (err) {
    console.warn(
      "creator invite DM Markdown failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // Niente parse_mode (link grezzo ok) + ← Indietro.
  try {
    const msg = await ctx.reply(text.replace(/\\([_*`\[])/g, "$1"), {
      reply_markup,
    });
    return msg.message_id;
  } catch (err) {
    console.error(
      "creator invite DM plain failed:",
      err instanceof Error ? err.message : err,
    );
    try {
      const msg = await ctx.reply(
        `✅ Gruppo creato.\nEntra e invita l'altra parte:\n${creatorLink}`,
        { reply_markup },
      );
      return msg.message_id;
    } catch (lastErr) {
      console.error(
        "creator invite DM plain fallback failed:",
        lastErr instanceof Error ? lastErr.message : lastErr,
      );
      return undefined;
    }
  }
}

/** Deep link DM: apre il bot e (opz.) avvia /crea dopo /start. */
function privateCreaDeepLink(ctx: BotContext): string {
  return `https://t.me/${botUsername(ctx)}?start=crea`;
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

/**
 * Avvia /crea in DM (dopo gate). Invito opzionale/obbligatorio/admin-only
 * a seconda di `APP_ENV` / `CREATE_GATE`. Esportato per deep-link `/start crea`.
 */
export async function beginCreateDealFlow(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  if (!(await requireRegistered(ctx))) return;
  if (!isSolanaConfigured()) {
    await ctx.reply(it.solanaNotConfigured);
    return;
  }

  // Staging: solo admin crea (backtest). Soft-launch production: invite-only.
  if (config.createGate === "admin" && !isAdminUser(ctx.from.id)) {
    await ctx.reply(it.createGateAdminOnly, { parse_mode: "Markdown" });
    return;
  }

  // Switching to crea: /miei + bozze unbound + termini/istruzioni leftover
  await cancelLeftoverCreaForNewFlow(ctx);
  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }

  // Deep-link /start invito_CODE → applica silenzioso a questo deal, no re-ask
  const pending = ctx.session.pendingInviteCode;
  if (pending) {
    ctx.session.pendingInviteCode = undefined;
    const looked = lookupDealInvite(ctx, pending);
    if (looked.ok) {
      ctx.session.creating = {
        step: "role",
        ...looked.attribution,
      };
      await proceedToRoleStep(ctx);
      return;
    }
    if (config.createGate === "invite") {
      await ctx.reply(it.createGateInviteRequired, { parse_mode: "Markdown" });
      ctx.session.creating = { step: "invite" };
      await askInviteOptional(ctx);
      return;
    }
  }

  // Gate admin: niente prompt invito (admin può creare senza codice).
  if (config.createGate === "admin") {
    ctx.session.creating = { step: "role" };
    await proceedToRoleStep(ctx);
    return;
  }

  // open = invito opzionale; invite = codice obbligatorio (niente skip).
  ctx.session.creating = { step: "invite" };
  await askInviteOptional(ctx);
}

/** Dopo skip/codice: passo ruolo. */
export async function proceedToRoleStep(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const prev = ctx.session.creating;
  ctx.session.creating = {
    step: "role",
    inviteCode: prev?.inviteCode,
    collaboratorUserId: prev?.collaboratorUserId,
    collaboratorWallet: prev?.collaboratorWallet,
  };
  ctx.session.awaitingInviteCode = undefined;
  const ask = await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
  trackCreatingEphemeral(ctx, ask.message_id);
}

export function registerCreateDealHandlers(bot: Bot<BotContext>): void {
  const beginCreate = async (ctx: BotContext) => {
    // Gruppo: redirect corto + deep link DM (mai il vecchio «apri privata…» fuorviante in DM)
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.creaInGroup, {
        parse_mode: "Markdown",
        reply_markup: openBotDmKeyboard(privateCreaDeepLink(ctx)),
      });
      return;
    }
    await beginCreateDealFlow(ctx);
  };

  bot.command("crea", beginCreate);
  bot.command("create", beginCreate);
  // Inline menu (primary) + legacy reply-keyboard label (pre-inline clients)
  bot.callbackQuery(MAIN_MENU_CREA_CB, async (ctx) => {
    await ctx.answerCallbackQuery();
    await beginCreate(ctx);
  });
  bot.hears(MAIN_MENU_CREA_LABEL, beginCreate);

  /** Skip invito durante /crea (igiene silenziosa → ruolo). */
  bot.callbackQuery("invite_skip", async (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!ctx.session.awaitingInviteCode) {
      await ctx.answerCallbackQuery({ text: "Nessun invito in attesa" });
      return;
    }
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // ok
    }
    const skipped = await completeInviteSkip(ctx);
    if (!skipped) return;
    if (ctx.session.creating?.step === "invite") {
      await proceedToRoleStep(ctx);
    }
  });

  bot.command("skip", async (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    const skipped = await completeInviteSkip(ctx, {
      userMessageId: ctx.message?.message_id,
    });
    if (!skipped) return;
    if (ctx.session.creating?.step === "invite") {
      await proceedToRoleStep(ctx);
    }
  });

  bot.hears("❌ Annulla", async (ctx) => {
    await cancelCreateWizard(ctx, { userMessageId: ctx.message?.message_id });
  });

  /** Legacy reply-keyboard taps (pre-inline); same gates as callbacks. */
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

  bot.callbackQuery(/^crea_role:(buyer|seller)$/, async (ctx) => {
    const role = ctx.match[1] as PartyRole;
    if (ctx.chat?.type !== "private" || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (ctx.session.creating?.step !== "role") {
      await ctx.answerCallbackQuery({ text: "Passo non attivo" });
      return;
    }
    await ctx.answerCallbackQuery();
    await pickRole(ctx, role);
  });

  bot.callbackQuery(/^crea_asset:(SOL|ETH|LTC)$/, async (ctx) => {
    const asset = ctx.match[1] as Asset;
    if (ctx.chat?.type !== "private" || !ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (ctx.session.creating?.step !== "asset") {
      await ctx.answerCallbackQuery({ text: "Passo non attivo" });
      return;
    }
    await ctx.answerCallbackQuery();
    if (asset === "SOL") {
      await pickAsset(ctx, asset);
      return;
    }
    await assetComingSoon(ctx, asset);
  });

  bot.callbackQuery("crea_cancel", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    const step = ctx.session.creating?.step;
    if (step !== "role" && step !== "asset") {
      await ctx.answerCallbackQuery({ text: "Niente da annullare" });
      return;
    }
    await ctx.answerCallbackQuery();
    await cancelCreateWizard(ctx);
  });

  bot.callbackQuery("tos", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Termini Escrowita" });
    // Fallback se manca PUBLIC_BASE_URL (niente Mini App): una riga, non dump.
    await ctx.reply(it.tosFallback(config.tosWebAppUrl), {
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    });
  });

  /** Group-ready DM: ← Indietro → menu Crea/I miei (link invita resta nel testo). */
  bot.callbackQuery(GROUP_READY_BACK_CB, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (ctx.chat?.type !== "private") return;
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: mainMenuKeyboard() });
    } catch {
      // Messaggio assente / non editabile.
    }
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

    // Legacy reply-keyboard menu: non mangiare come termini/ruolo — passa ai hears.
    if (MAIN_MENU_TEXTS.has(text)) {
      if (text === MAIN_MENU_MIEI_LABEL) {
        await cancelMidCreaBeforeGroupBind(ctx);
        ctx.session.creating = undefined;
        await dismissInviteStep(ctx);
      }
      await next();
      return;
    }

    // Step invito di /crea: codice libero o menu → avanti / dismiss
    if (
      ctx.session.awaitingInviteCode &&
      ctx.session.creating?.step === "invite" &&
      ctx.from &&
      ctx.members.isRegistered(ctx.from.id)
    ) {
      if (MENU_TEXTS.has(text)) {
        // Annulla / ruolo / crypto: chiudi invito; lascia passare i hears
        await dismissInviteStep(ctx);
        await next();
        return;
      }

      const maybe = text.replace(/^#/, "").trim();
      if (/^[A-Za-z0-9-]{4,24}$/.test(maybe)) {
        const looked = lookupDealInvite(ctx, maybe);
        if (!looked.ok) {
          await replyInviteAttachError(ctx, looked.reason, {
            userMessageId: ctx.message.message_id,
          });
          return;
        }
        await clearInvitePrompt(ctx);
        if (ctx.message.message_id != null) {
          await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
        }
        ctx.session.awaitingInviteCode = undefined;
        ctx.session.creating = {
          step: "role",
          ...looked.attribution,
        };
        // Silenzioso in DM: il codice compare solo sulla card pinnata del gruppo.
        await proceedToRoleStep(ctx);
        return;
      }

      // Testo non-codice: ignora — cancella echo e ripropone inline «Nessun codice»
      // così i bottoni restano in fondo anche dopo apertura tastiera telefono.
      await repromptInviteStep(ctx);
      return;
    }

    // Wizard termini: non accettare etichette tastiera come «prodotto»
    if (MENU_TEXTS.has(text) && (ctx.session.termsQa || ctx.session.creating)) {
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

    // Pre-«aggiungi bot» button steps: free text must not advance/break flow.
    if (creating.step === "invite") {
      await repromptInviteStep(ctx);
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

/** Annulla wizard /crea (hears ❌ o callback crea_cancel). */
async function cancelCreateWizard(
  ctx: BotContext,
  opts?: { userMessageId?: number },
): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  await cancelLeftoverCreaForNewFlow(ctx);
  const userMsgId = opts?.userMessageId;
  if (userMsgId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, userMsgId);
  }
  await replyWithMainMenu(ctx, it.cancelled);
}

/** Free text mid-invite: delete user echo + re-send prompt with inline skip. */
async function repromptInviteStep(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }
  await askInviteOptional(ctx);
}

async function handlePrivateTermsReply(
  ctx: BotContext,
  text: string,
): Promise<boolean> {
  if (!ctx.from || ctx.chat?.type !== "private") return false;

  // Mid invite/role/asset: non riagganciare un deal termini orfano.
  if (ctx.session.creating && !ctx.session.termsQa) return false;

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
    // Igiene: cancella subito la risposta invalida (es. «ciao» al prezzo).
    if (ctx.message?.message_id != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
    }
    let errText: string | undefined;
    if (result.reason === "price") {
      errText = it.dmTermsInvalidPrice;
    } else if (result.reason === "short" || result.reason === "empty") {
      errText = it.dmTermsTooShort;
    }
    if (errText) {
      const err = await ctx.reply(errText, { parse_mode: "Markdown" });
      const prev = ctx.session.termsErrorMessageIds ?? [];
      ctx.session.termsErrorMessageIds = [...prev, err.message_id];
    }
    return true;
  }

  // Step valido: togli errori prezzo/corto precedenti.
  await clearTermsErrorMessages(ctx);

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
  const prev = ctx.session.creating;
  // Solo sul passo ruolo (niente skip invito / stale tap mid-termini).
  if (!prev || prev.step !== "role") return;
  ctx.session.creating = {
    step: "asset",
    role,
    inviteCode: prev.inviteCode,
    collaboratorUserId: prev.collaboratorUserId,
    collaboratorWallet: prev.collaboratorWallet,
  };
  await replaceCreatingPrompt(ctx, () =>
    ctx.reply(it.askAsset, { reply_markup: assetKeyboard() }),
  );
}

async function pickAsset(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset" || !creating.role) {
    ctx.session.creating = {
      step: "role",
      inviteCode: creating?.inviteCode,
      collaboratorUserId: creating?.collaboratorUserId,
      collaboratorWallet: creating?.collaboratorWallet,
    };
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
  // Reply KB resta stripata per termini + helper create (menu = inline a fine flusso).
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

  // Opener (buyer o seller) = proponente termini: 3 domande subito.
  // TTL da create (non solo da istruzioni gruppo) così wizard abbandonato scade.
  const updated =
    ctx.store.update(deal.id, {
      escrowAddress,
      tosProposedBy: ctx.from.id,
      awaitingGroupExpiresAt: groupBindExpiresAtIso(),
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

  // Path preferito: servizio crea il gruppo (helper MTProto). Bot API non può.
  if (preferBotCreatedGroups()) {
    if (!groupCreatorReady()) {
      current = await sendGroupBindInstructions(ctx, current);
      await replyWithMainMenu(ctx, it.groupCreateHelperMissing(current), {
        parse_mode: "Markdown",
      });
      return;
    }

    // Effimero «Sto creando…» → cancellato in finally (link DM o errore).
    let creatingMsgId: number | undefined;
    try {
      const creatingMsg = await ctx.reply(it.creatingGroup);
      creatingMsgId = creatingMsg.message_id;
    } catch {
      // Soft-fail: procedi senza l'effimero.
    }

    try {
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
            groupInviteLink: created.creatorInviteLink,
            counterpartInviteLink: created.counterpartInviteLink,
            groupCreatedVia: "helper",
            groupAccessHash: created.accessHash,
            awaitingGroupExpiresAt: undefined,
            dmGroupInstructionsMessageId: undefined,
          }) ?? current;

        // Setup gruppo (invite A+B) non deve bloccare il DM col link creator.
        let started = withGroup;
        let permsOk = true;
        let missingPerms: RequiredBotPerm[] = [];
        let notAdmin = false;
        try {
          const result = await startDealInGroup(
            ctx.api,
            ctx.store,
            withGroup,
            created.chatId,
          );
          started = result.deal;
          permsOk = result.perms.ok;
          if (!result.perms.ok) {
            missingPerms = result.perms.missing;
            notAdmin = result.perms.notAdmin;
          }
        } catch (err) {
          console.error(
            `startDealInGroup after helper create #${withGroup.id}:`,
            err instanceof Error ? err.message : err,
          );
          // Best-effort: posta comunque i due messaggi invite nel gruppo.
          try {
            started = await postHelperCounterpartInvite(
              ctx.api,
              ctx.store,
              withGroup,
            );
          } catch (postErr) {
            console.warn(
              `postHelperCounterpartInvite fallback #${withGroup.id}:`,
              postErr instanceof Error ? postErr.message : postErr,
            );
          }
        }

        // DM: link creator + «entra nel gruppo e invita il buyer/seller».
        const creatorLink = created.creatorInviteLink;
        const inviteMsgId = !permsOk
          ? await replyCreatorInviteDm(
              ctx,
              it.missingBotPerms(missingPerms, { notAdmin }),
              creatorLink,
            )
          : await replyCreatorInviteDm(
              ctx,
              it.groupReady(
                started,
                {
                  creatorLink,
                  counterpartLink: created.counterpartInviteLink,
                },
                created.creatorInvited,
              ),
              creatorLink,
            );
        if (inviteMsgId != null) {
          const prev = started.dmCreatorInviteMessageIds ?? [];
          ctx.store.update(started.id, {
            dmCreatorInviteMessageIds: [...prev, inviteMsgId],
          });
        }
        return;
      }

      // Create fallita: emergenza manuale + errore chiaro.
      current = await sendGroupBindInstructions(ctx, current);
      await replyWithMainMenu(
        ctx,
        it.groupCreateFailed(current, created.error),
        { parse_mode: "Markdown" },
      );
      return;
    } finally {
      if (creatingMsgId != null && ctx.chat?.type === "private") {
        await deleteMessageSafe(ctx.api, ctx.chat.id, creatingMsgId);
      }
    }
  }

  // Opt-out esplicito (TELEGRAM_BOT_CREATES_GROUPS=0): gruppo manuale legacy.
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

/**
 * Snapshot invito sul deal (fee 2.5% collab alla release).
 * Preferisce il codice scelto in questo /crea; fallback member.inviteCode (/invito).
 */
function resolveCreatorInvite(ctx: BotContext): {
  inviteCode?: string;
  collaboratorUserId?: number;
  collaboratorWallet?: string;
} {
  const fromCrea = ctx.session.creating;
  if (
    fromCrea?.inviteCode &&
    fromCrea.collaboratorUserId != null &&
    fromCrea.collaboratorWallet
  ) {
    return {
      inviteCode: fromCrea.inviteCode,
      collaboratorUserId: fromCrea.collaboratorUserId,
      collaboratorWallet: fromCrea.collaboratorWallet,
    };
  }
  if (!ctx.from) return {};
  const member = ctx.members.get(ctx.from.id);
  const code = member?.inviteCode;
  if (!code) return {};
  const looked = lookupDealInvite(ctx, code);
  if (!looked.ok) return {};
  return looked.attribution;
}
