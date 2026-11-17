import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { isAdminUser } from "../services/deal-logic.js";
import { it } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { registerHandleFromMessage } from "../services/registration.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";

async function askForHandle(ctx: BotContext): Promise<void> {
  ctx.session.awaitingHandle = true;
  ctx.session.creating = undefined;
  ctx.session.termsQa = undefined;
  if (ctx.session.signupPromptMessageId != null && ctx.chat) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.signupPromptMessageId,
    );
  }
  const msg = await ctx.reply(it.welcomeAskHandle, {
    parse_mode: "Markdown",
  });
  ctx.session.signupPromptMessageId = msg.message_id;
}

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    // /start in gruppo arriva spesso da startgroup=payload
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      return;
    }

    if (!ctx.from) return;

    try {
      if (ctx.members.isRegistered(ctx.from.id)) {
        const member = ctx.members.touch(ctx.from.id, ctx.from.username);
        ctx.session.awaitingHandle = undefined;
        ctx.session.signupPromptMessageId = undefined;
        await ctx.reply(it.welcomeBack(member.username), {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(),
        });
        console.log(
          `/start ok chat=${ctx.chat?.id} from=${ctx.from.id} reconnected iscritti=${ctx.members.registeredCount}`,
        );
        return;
      }

      // Soft signup: solo @, niente auto-iscrizione al /start
      ctx.members.touch(ctx.from.id);
      await askForHandle(ctx);
      console.log(
        `/start ask-handle chat=${ctx.chat?.id} from=${ctx.from.id}`,
      );
    } catch (err) {
      console.error(
        `/start fail chat=${ctx.chat?.id} from=${ctx.from.id}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  });

  /** Admin: conteggio iscritti (+ ultimi recenti). */
  bot.command("iscritti", async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    const total = ctx.members.registeredCount;
    const recent = ctx.members.listRecent(8);
    const lines = recent.map((m) => {
      const who = m.username ? `@${m.username}` : String(m.userId);
      const day = m.lastSeen.slice(0, 10);
      return `• ${who} · ${day}`;
    });
    const body =
      lines.length > 0
        ? `${it.iscrittiCount(total)}\n\n${lines.join("\n")}`
        : it.iscrittiCount(total);
    await ctx.reply(body, { parse_mode: "Markdown" });
  });

  /** Soft signup: risposta con @ dopo /start (o se ancora non iscritto). */
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from) {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    const awaiting =
      ctx.session.awaitingHandle || !ctx.members.isRegistered(ctx.from.id);
    if (!awaiting) {
      await next();
      return;
    }

    // Non rubare wizard crea/termini già attivi se iscritto; se non iscritto
    // la @ ha priorità (gate).
    if (
      ctx.members.isRegistered(ctx.from.id) &&
      (ctx.session.creating || ctx.session.termsQa)
    ) {
      await next();
      return;
    }

    const result = await registerHandleFromMessage(ctx, text);
    if (!result.ok) {
      if (result.reason === "no_telegram_username") {
        await ctx.reply(it.handleNeedTelegramUsername, {
          parse_mode: "Markdown",
        });
        return;
      }
      if (result.reason === "mismatch") {
        await ctx.reply(it.handleMismatch(ctx.from.username), {
          parse_mode: "Markdown",
        });
        return;
      }
      // invalid: se non stiamo aspettando handle esplicitamente, passa oltre
      if (ctx.session.awaitingHandle) {
        await ctx.reply(it.handleInvalid, { parse_mode: "Markdown" });
        return;
      }
      await next();
      return;
    }

    const copy = result.reconnected
      ? it.welcomeBack(result.username)
      : it.registeredOk(result.username);
    await ctx.reply(copy, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });
}
