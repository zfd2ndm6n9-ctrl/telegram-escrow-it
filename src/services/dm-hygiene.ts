import type { BotContext } from "../context.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { it } from "../messages/it.js";
import { clearDmTermsUi } from "./dm-terms.js";
import { dismissInviteStep } from "./invite-step.js";
import {
  deleteMessageSafe,
  EPHEMERAL_NOTICE_MS,
  scheduleMessageCleanup,
} from "./prompt-cleanup.js";

/**
 * Risposta DM con menu inline (Crea / I miei) sul messaggio stesso.
 * Niente ReplyKeyboard sotto l'input; niente strip/ghost carrier.
 */
export async function replyWithMainMenu(
  ctx: BotContext,
  text: string,
  extra?: { parse_mode?: "Markdown" | "HTML" },
): Promise<{ message_id: number }> {
  return ctx.reply(text, {
    ...extra,
    reply_markup: mainMenuKeyboard(),
  });
}

/**
 * Notice breve senza tastiera; auto-delete (bot + opz. echo utente).
 * Usato per «Operazione annullata.» senza restackare Crea / I miei.
 */
export async function replyEphemeralNotice(
  ctx: BotContext,
  text: string,
  opts?: {
    parse_mode?: "Markdown" | "HTML";
    userMessageId?: number;
    delayMs?: number;
  },
): Promise<void> {
  if (!ctx.chat) return;
  let botMsgId: number | undefined;
  try {
    const msg = await ctx.reply(text, {
      parse_mode: opts?.parse_mode,
    });
    botMsgId = msg.message_id;
  } catch {
    return;
  }
  scheduleMessageCleanup(
    ctx.api,
    ctx.chat.id,
    [botMsgId, opts?.userMessageId],
    opts?.delayMs ?? EPHEMERAL_NOTICE_MS,
  );
}

/**
 * Path admin-only per non-admin: «Solo admin.» (o simile) poi sweep.
 * Cancella anche il comando utente se Telegram lo permette.
 */
export async function replyAdminDenied(
  ctx: BotContext,
  text: string = it.adminOnly,
  opts?: { parse_mode?: "Markdown" | "HTML"; delayMs?: number },
): Promise<void> {
  await replyEphemeralNotice(ctx, text, {
    parse_mode: opts?.parse_mode,
    userMessageId: ctx.message?.message_id,
    delayMs: opts?.delayMs,
  });
}

/** Igiene: cancella messaggi effimeri del wizard /crea (ruolo, crypto, risposte). */
export async function clearCreatingEphemeral(ctx: BotContext): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  const ids = ctx.session.creatingEphemeralIds ?? [];
  for (const id of ids) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.creatingEphemeralIds = undefined;
}

export function trackCreatingEphemeral(
  ctx: BotContext,
  messageId?: number,
): void {
  if (messageId == null) return;
  const prev = ctx.session.creatingEphemeralIds ?? [];
  ctx.session.creatingEphemeralIds = [...prev, messageId];
}

/** Rimuove lista /miei precedente (bot + eventuale echo comando). */
export async function clearMieiUi(ctx: BotContext): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  if (ctx.session.mieiUserCommandMessageId != null) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.mieiUserCommandMessageId,
    );
  }
  if (ctx.session.mieiListMessageId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.session.mieiListMessageId);
  }
  ctx.session.mieiUserCommandMessageId = undefined;
  ctx.session.mieiListMessageId = undefined;
}

/** Cancella errori wizard termini DM tracciati in session. */
export async function clearTermsErrorMessages(ctx: BotContext): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  for (const id of ctx.session.termsErrorMessageIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.termsErrorMessageIds = undefined;
}

/**
 * Mid /crea (ruolo/crypto o wizard termini) prima del messaggio «aggiungi bot».
 * Dopo `dmGroupInstructionsMessageId` il deal è pronto: non cancellare (per /miei).
 */
export function isMidCreaBeforeGroupBind(ctx: BotContext): boolean {
  if (ctx.session.creating) return true;
  const termsQa = ctx.session.termsQa;
  if (!termsQa) return false;
  const deal = ctx.store.get(termsQa.dealId);
  if (!deal) return true;
  if (deal.groupChatId != null) return false;
  if (deal.dmGroupInstructionsMessageId != null) return false;
  return true;
}

/**
 * Se mid /crea prima di «aggiungi bot»: cancella sequenza crea/termini e
 * annulla il deal in bozza. Ritorna true se ha cancellato qualcosa.
 */
export async function cancelMidCreaBeforeGroupBind(
  ctx: BotContext,
): Promise<boolean> {
  if (ctx.chat?.type !== "private") return false;
  if (!isMidCreaBeforeGroupBind(ctx)) return false;

  const termsQa = ctx.session.termsQa;
  if (termsQa) {
    const deal = ctx.store.get(termsQa.dealId);
    if (deal && deal.status === "awaiting_group" && !deal.groupChatId) {
      ctx.store.setStatus(deal.id, "cancelled");
      await clearDmTermsUi(ctx.api, ctx.store, deal, ctx.chat.id);
    }
  }

  await clearTermsErrorMessages(ctx);
  await dismissInviteStep(ctx);
  await clearCreatingEphemeral(ctx);
  ctx.session.creating = undefined;
  ctx.session.termsQa = undefined;
  return true;
}

/**
 * Annulla una bozza unbound (niente groupChatId): termini + istruzioni DM.
 */
async function cancelUnboundDraft(
  ctx: BotContext,
  deal: NonNullable<ReturnType<BotContext["store"]["get"]>>,
): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  if (deal.groupChatId != null) return;
  if (deal.status === "cancelled" || deal.status === "released" || deal.status === "refunded") {
    return;
  }

  if (deal.status === "awaiting_group" || deal.status === "awaiting_bot_admin") {
    ctx.store.setStatus(deal.id, "cancelled");
  }

  await clearDmTermsUi(ctx.api, ctx.store, deal, ctx.chat.id);

  const instructionsId = deal.dmGroupInstructionsMessageId;
  if (instructionsId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, instructionsId);
    ctx.store.update(deal.id, {
      dmGroupInstructionsMessageId: undefined,
      awaitingGroupExpiresAt: undefined,
    });
  }
}

/**
 * Cancella notice «deal scaduto» (group-bind TTL) del creator, se tracciato.
 */
export async function clearExpiredGroupBindNotices(
  ctx: BotContext,
): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private" || !ctx.from) return;

  for (const deal of ctx.store.listForUser(ctx.from.id)) {
    if (deal.creatorId !== ctx.from.id) continue;
    const noticeId = deal.dmGroupBindExpiredMessageId;
    if (noticeId == null) continue;
    await deleteMessageSafe(ctx.api, ctx.chat.id, noticeId);
    ctx.store.update(deal.id, {
      dmGroupBindExpiredMessageId: undefined,
    });
  }
}

/**
 * Nuovo /crea: pulisci /miei + qualsiasi bozza unbound del creator
 * (mid-wizard *o* istruzioni «aggiungi bot» ancora senza gruppo).
 * Evita stack e resume orfano via findOpenTermsDeal.
 * Cancella anche eventuali notice «deal scaduto» da TTL group-bind.
 */
export async function cancelLeftoverCreaForNewFlow(
  ctx: BotContext,
): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  await clearMieiUi(ctx);
  await cancelMidCreaBeforeGroupBind(ctx);
  await clearExpiredGroupBindNotices(ctx);

  for (const deal of ctx.store.listForUser(ctx.from.id)) {
    if (deal.creatorId !== ctx.from.id) continue;
    if (deal.groupChatId != null) continue;
    if (
      deal.status !== "awaiting_group" &&
      deal.status !== "awaiting_bot_admin"
    ) {
      continue;
    }
    await cancelUnboundDraft(ctx, deal);
  }

  await clearTermsErrorMessages(ctx);
  await dismissInviteStep(ctx);
  await clearCreatingEphemeral(ctx);
  ctx.session.creating = undefined;
  ctx.session.termsQa = undefined;
  ctx.session.pendingCrea = undefined;
  await clearFeedbackUi(ctx);
}

/** Igiene: cancella prompt + effimeri del flusso feedback DM. */
export async function clearFeedbackUi(ctx: BotContext): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  if (ctx.session.feedbackPromptMessageId != null) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.feedbackPromptMessageId,
    );
  }
  for (const id of ctx.session.feedbackEphemeralIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.feedbackPromptMessageId = undefined;
  ctx.session.feedbackEphemeralIds = undefined;
  ctx.session.awaitingFeedback = undefined;
}

export function trackFeedbackEphemeral(
  ctx: BotContext,
  messageId?: number,
): void {
  if (messageId == null) return;
  const prev = ctx.session.feedbackEphemeralIds ?? [];
  ctx.session.feedbackEphemeralIds = [...prev, messageId];
}
