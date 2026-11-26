import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { inviteSkipKeyboard } from "../keyboards/menus.js";
import { it } from "../messages/it.js";
import { isValidSolAddress } from "./solana/index.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

export type DealInviteAttribution = {
  inviteCode: string;
  collaboratorUserId: number;
  collaboratorWallet: string;
};

function trackInviteEphemeral(ctx: BotContext, messageId: number): void {
  const prev = ctx.session.inviteEphemeralIds ?? [];
  ctx.session.inviteEphemeralIds = [...prev, messageId];
}

export async function clearInvitePrompt(ctx: BotContext): Promise<void> {
  if (!ctx.chat) return;
  if (ctx.session.invitePromptMessageId != null) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.invitePromptMessageId,
    );
  }
  for (const id of ctx.session.inviteEphemeralIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.invitePromptMessageId = undefined;
  ctx.session.inviteEphemeralIds = undefined;
}

/** Chiude lo step invito opzionale senza rispostone (es. tap su /miei). */
export async function dismissInviteStep(ctx: BotContext): Promise<void> {
  if (!ctx.session.awaitingInviteCode) return;
  await clearInvitePrompt(ctx);
  ctx.session.awaitingInviteCode = undefined;
}

/** Prompt invito su /crea: opzionale (`open`) o obbligatorio (`invite`). */
export async function askInviteOptional(ctx: BotContext): Promise<void> {
  ctx.session.awaitingInviteCode = true;
  if (ctx.chat && ctx.session.invitePromptMessageId != null) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.invitePromptMessageId,
    );
  }
  const required = config.createGate === "invite";
  const msg = await ctx.reply(
    required ? it.createGateInviteAsk : it.askInviteOptional,
    {
      parse_mode: "Markdown",
      reply_markup: required ? undefined : inviteSkipKeyboard(),
    },
  );
  ctx.session.invitePromptMessageId = msg.message_id;
}

/**
 * Skip invito solo se in attesa (tap bottone o /skip) e gate `open`.
 * Silenzioso: cancella il prompt, niente «Ok, nessun codice.»
 * Con `CREATE_GATE=invite` lo skip è rifiutato.
 */
export async function completeInviteSkip(
  ctx: BotContext,
  opts?: { userMessageId?: number },
): Promise<boolean> {
  if (!ctx.session.awaitingInviteCode) return false;
  if (config.createGate === "invite") {
    const msg = await ctx.reply(it.createGateInviteRequired, {
      parse_mode: "Markdown",
    });
    trackInviteEphemeral(ctx, msg.message_id);
    return false;
  }
  const userMsgId = opts?.userMessageId;
  await clearInvitePrompt(ctx);
  if (userMsgId != null && ctx.chat) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, userMsgId);
  }
  ctx.session.awaitingInviteCode = undefined;
  return true;
}

/**
 * Valida un codice per attributire *questo* deal (/crea).
 * Non blocca codici diversi su deal successivi (snapshot sul deal).
 */
export function lookupDealInvite(
  ctx: BotContext,
  rawCode: string,
):
  | { ok: true; attribution: DealInviteAttribution }
  | { ok: false; reason: "not_found" | "inactive" | "bad_wallet" } {
  const code = rawCode.trim().toUpperCase().replace(/^#/, "");
  if (!code || code.length < 4) {
    return { ok: false, reason: "not_found" };
  }
  const invite = ctx.invites.get(code);
  if (!invite) return { ok: false, reason: "not_found" };
  if (!invite.active) return { ok: false, reason: "inactive" };
  const wallet = invite.collaboratorWallet?.trim();
  if (!wallet || !isValidSolAddress(wallet)) {
    return { ok: false, reason: "bad_wallet" };
  }
  return {
    ok: true,
    attribution: {
      inviteCode: invite.code,
      collaboratorUserId: invite.collaboratorUserId,
      collaboratorWallet: wallet,
    },
  };
}

/** Errore corto durante lo step invito di /crea (igiene). */
export async function replyInviteAttachError(
  ctx: BotContext,
  reason: "not_found" | "inactive" | "bad_wallet",
  opts?: { userMessageId?: number },
): Promise<void> {
  void reason;
  const msg = await ctx.reply(it.inviteNotFound);
  trackInviteEphemeral(ctx, msg.message_id);
  if (opts?.userMessageId != null && ctx.chat) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, opts.userMessageId);
    trackInviteEphemeral(ctx, opts.userMessageId);
  }
}

export { trackInviteEphemeral };
