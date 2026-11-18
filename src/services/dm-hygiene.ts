import type { BotContext } from "../context.js";
import { clearDmTermsUi } from "./dm-terms.js";
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

/**
 * Mid /crea (ruolo/crypto o wizard termini) prima del messaggio «aggiungi bot».
 * Dopo `dmGroupInstructionsMessageId` il deal è pronto: non cancellare.
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

  for (const id of ctx.session.termsErrorMessageIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.termsErrorMessageIds = undefined;

  await clearCreatingEphemeral(ctx);
  ctx.session.creating = undefined;
  ctx.session.termsQa = undefined;
  return true;
}
