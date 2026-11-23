import type { BotContext } from "../context.js";
import { clearDmTermsUi } from "./dm-terms.js";
import { dismissInviteStep } from "./invite-step.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

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
 * Nuovo /crea: pulisci /miei + qualsiasi bozza unbound del creator
 * (mid-wizard *o* istruzioni «aggiungi bot» ancora senza gruppo).
 * Evita stack e resume orfano via findOpenTermsDeal.
 */
export async function cancelLeftoverCreaForNewFlow(
  ctx: BotContext,
): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  await clearMieiUi(ctx);
  await cancelMidCreaBeforeGroupBind(ctx);

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
}
