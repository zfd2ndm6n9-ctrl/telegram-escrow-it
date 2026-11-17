import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import { normalizeUsername } from "../store/members.js";
import { publishIscrittiCount } from "./public-count.js";
import { deleteMessageSafe } from "./prompt-cleanup.js";

/**
 * Gate iscrizione soft (@ confermata). Se manca, invita a /start + @.
 * Non usare su my_chat_member / setup admin del bot.
 */
export async function requireRegistered(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  if (ctx.members.isRegistered(ctx.from.id)) return true;
  await ctx.reply(it.needRegistration, { parse_mode: "Markdown" });
  return false;
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

  // Igiene: cancella domanda @ + risposta utente
  const promptId = ctx.session.signupPromptMessageId;
  if (promptId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, promptId);
  }
  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }
  ctx.session.awaitingHandle = undefined;
  ctx.session.signupPromptMessageId = undefined;

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
