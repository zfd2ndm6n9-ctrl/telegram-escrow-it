import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import { normalizeUsername } from "../store/members.js";
import { publishIscrittiCount } from "./public-count.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";
import {
  checkVouchMembership,
  vouchInviteLink,
  vouchJoinKeyboard,
} from "./vouch-membership.js";

/**
 * Gate opener: iscrizione (/start) + canale vouch (hard) + @ (soft).
 * Solo opener: /crea, wizard termini opener, tooling invito.
 * Non usare su azioni controparte in gruppo (/wallet, Accetta, /avvia, release)
 * né su my_chat_member / promote admin del bot.
 */
export async function requireRegistered(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;

  if (!ctx.members.isRegistered(ctx.from.id)) {
    await ctx.reply(it.needRegistration, { parse_mode: "Markdown" });
    return false;
  }

  // Sync @ se Telegram l'ha ora
  if (ctx.from.username) {
    ctx.members.touch(ctx.from.id, ctx.from.username);
  }

  const vouch = await checkVouchMembership(ctx.api, ctx.from.id);
  if (vouch.ok && !vouch.member) {
    await ctx.reply(it.needVouchJoin(vouchInviteLink()), {
      parse_mode: "Markdown",
      reply_markup: vouchJoinKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    return false;
  }
  if (!vouch.ok && vouch.reason === "api_error") {
    // Bot non admin / canale sbagliato: non aprire il gate; chiedi join + /start
    await ctx.reply(it.needVouchJoin(vouchInviteLink()), {
      parse_mode: "Markdown",
      reply_markup: vouchJoinKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    return false;
  }
  // no_channel: ambiente senza VOUCH_CHANNEL_ID → non bloccare (dev), log già a boot

  if (!ctx.from.username && !ctx.members.hasUsername(ctx.from.id)) {
    await ctx.reply(it.needUsernameSoft, { parse_mode: "Markdown" });
    return false;
  }

  return true;
}

/** Estrae un possibile @handle da testo libero. */
export function parseHandleInput(text: string): string | undefined {
  const t = text.trim();
  if (!t || t.startsWith("/")) return undefined;
  // @handle oppure solo username (3–32, lettere/numeri/underscore)
  const m = t.match(/^@?([A-Za-z0-9_]{3,32})$/);
  if (!m?.[1]) return undefined;
  return m[1];
}

export type RegisterHandleResult =
  | { ok: true; isNew: boolean; reconnected: boolean; username: string }
  | {
      ok: false;
      reason: "no_telegram_username" | "mismatch" | "invalid";
    };

/**
 * Valida che l'@ inviata coincida con l'username Telegram corrente,
 * registra/riconnette il profilo, pubblica il conteggio se nuovo iscritto.
 * Path legacy / opzionale (utente senza @ che la imposta e la reinvia).
 */
export async function registerHandleFromMessage(
  ctx: BotContext,
  rawText: string,
): Promise<RegisterHandleResult> {
  if (!ctx.from || ctx.chat?.type !== "private") {
    return { ok: false, reason: "invalid" };
  }

  const parsed = parseHandleInput(rawText);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }

  const tgUsername = ctx.from.username;
  if (!tgUsername) {
    return { ok: false, reason: "no_telegram_username" };
  }

  if (normalizeUsername(parsed) !== normalizeUsername(tgUsername)) {
    return { ok: false, reason: "mismatch" };
  }

  const result = ctx.members.registerWithUsername(ctx.from.id, tgUsername);

  if (result.previousUserId != null) {
    const remapped = ctx.store.remapUserId(
      result.previousUserId,
      ctx.from.id,
    );
    console.log(
      `Riconnessione @${tgUsername}: userId ${result.previousUserId} → ${ctx.from.id}, deal rimappati=${remapped}`,
    );
  }

  // Igiene: cancella domanda @, errori precedenti, risposte utente
  const promptId = ctx.session.signupPromptMessageId;
  if (promptId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, promptId);
  }
  for (const id of ctx.session.signupEphemeralIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }
  ctx.session.awaitingHandle = undefined;
  ctx.session.signupPromptMessageId = undefined;
  ctx.session.signupEphemeralIds = undefined;

  if (result.isNew) {
    await publishIscrittiCount(ctx.api, ctx.members.registeredCount);
  }

  return {
    ok: true,
    isNew: result.isNew,
    reconnected: result.reconnected,
    username: tgUsername,
  };
}
