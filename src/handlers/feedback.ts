import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import {
  FEEDBACK_CANCEL_CB,
  MAIN_MENU_CREA_LABEL,
  MAIN_MENU_FEEDBACK_CB,
  MAIN_MENU_FEEDBACK_LABEL,
  MAIN_MENU_MIEI_LABEL,
  feedbackPromptKeyboard,
} from "../keyboards/menus.js";
import { it } from "../messages/it.js";
import {
  cancelMidCreaBeforeGroupBind,
  clearFeedbackUi,
  clearMieiUi,
  replyEphemeralNotice,
  trackFeedbackEphemeral,
} from "../services/dm-hygiene.js";
import { dismissInviteStep } from "../services/invite-step.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";

const FEEDBACK_BODY_MAX = 3500;

function normalizeFeedbackText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

async function beginFeedbackFlow(ctx: BotContext): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  // Chiudi clutter parallelo: /miei, mid-/crea, invito, feedback precedente.
  await clearMieiUi(ctx);
  await cancelMidCreaBeforeGroupBind(ctx);
  await dismissInviteStep(ctx);
  await clearFeedbackUi(ctx);

  if (ctx.message?.message_id != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
  }

  const ask = await ctx.reply(it.feedbackAsk, {
    reply_markup: feedbackPromptKeyboard(),
  });
  ctx.session.awaitingFeedback = true;
  ctx.session.feedbackPromptMessageId = ask.message_id;
}

async function cancelFeedbackFlow(
  ctx: BotContext,
  opts?: { userMessageId?: number },
): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  await clearFeedbackUi(ctx);
  if (opts?.userMessageId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, opts.userMessageId);
  }
  // Callback: toast già in answerCallbackQuery. Hears: notice senza menu.
  if (opts?.userMessageId != null) {
    await replyEphemeralNotice(ctx, it.cancelled);
  }
}

async function submitFeedback(
  ctx: BotContext,
  rawText: string,
): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  const body = normalizeFeedbackText(rawText);
  if (!body) {
    if (ctx.message?.message_id != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
      trackFeedbackEphemeral(ctx, ctx.message.message_id);
    }
    const err = await ctx.reply(it.feedbackNeedText);
    trackFeedbackEphemeral(ctx, err.message_id);
    return;
  }

  const clipped =
    body.length > FEEDBACK_BODY_MAX
      ? `${body.slice(0, FEEDBACK_BODY_MAX)}…`
      : body;

  const adminIds = config.adminTelegramIds;
  if (!adminIds.length) {
    await clearFeedbackUi(ctx);
    if (ctx.message?.message_id != null) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
    }
    await replyEphemeralNotice(ctx, it.feedbackAdminMissing, {
      delayMs: 5_000,
    });
    return;
  }

  const notify = it.feedbackAdminNotify(
    ctx.from.username,
    ctx.from.id,
    clipped,
  );
  let anyOk = false;
  for (const adminId of adminIds) {
    try {
      await ctx.api.sendMessage(adminId, notify, { parse_mode: "Markdown" });
      anyOk = true;
    } catch (err) {
      console.error(`Feedback admin ${adminId} fallito:`, err);
    }
  }

  const userMsgId = ctx.message?.message_id;
  await clearFeedbackUi(ctx);
  if (userMsgId != null) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, userMsgId);
  }

  await replyEphemeralNotice(
    ctx,
    anyOk ? it.feedbackThanks : it.feedbackAdminMissing,
    { delayMs: 4_000 },
  );
}

export function registerFeedbackHandlers(bot: Bot<BotContext>): void {
  bot.callbackQuery(MAIN_MENU_FEEDBACK_CB, async (ctx) => {
    await ctx.answerCallbackQuery();
    await beginFeedbackFlow(ctx);
  });

  bot.hears(MAIN_MENU_FEEDBACK_LABEL, beginFeedbackFlow);

  bot.callbackQuery(FEEDBACK_CANCEL_CB, async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    if (!ctx.session.awaitingFeedback) {
      await ctx.answerCallbackQuery({ text: "Niente da annullare" });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Annullato" });
    await cancelFeedbackFlow(ctx);
  });

  bot.hears("❌ Annulla", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.session.awaitingFeedback) {
      await next();
      return;
    }
    await cancelFeedbackFlow(ctx, {
      userMessageId: ctx.message?.message_id,
    });
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.session.awaitingFeedback) {
      await next();
      return;
    }
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      // Comandi: chiudi feedback e lascia passare (/crea, /miei, …).
      await clearFeedbackUi(ctx);
      await next();
      return;
    }
    if (text === "❌ Annulla" || text === MAIN_MENU_FEEDBACK_LABEL) {
      await next();
      return;
    }
    // Altri tap menu (Crea / I miei): esci dal feedback, passa ai hears.
    if (text === MAIN_MENU_CREA_LABEL || text === MAIN_MENU_MIEI_LABEL) {
      await clearFeedbackUi(ctx);
      await next();
      return;
    }
    await submitFeedback(ctx, text);
  });
}
