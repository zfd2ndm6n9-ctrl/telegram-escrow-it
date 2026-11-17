import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { isAdminUser } from "../services/deal-logic.js";
import { it } from "../messages/it.js";
import { mainMenuKeyboard } from "../keyboards/menus.js";
import { registerHandleFromMessage } from "../services/registration.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import { isValidSolAddress, lamportsToSolString } from "../services/solana/index.js";

/** Pulsanti menu / wizard: non sono un codice invito. */
const MENU_TEXTS = new Set([
  "➕ Crea escrow",
  "📋 I miei deal",
  "❌ Annulla",
  "🛒 Sono il buyer",
  "🏪 Sono il seller",
  "◎ SOL",
  "ETH (presto)",
  "LTC (presto)",
]);

function trackSignupEphemeral(ctx: BotContext, messageId: number): void {
  const prev = ctx.session.signupEphemeralIds ?? [];
  ctx.session.signupEphemeralIds = [...prev, messageId];
}

function trackInviteEphemeral(ctx: BotContext, messageId: number): void {
  const prev = ctx.session.inviteEphemeralIds ?? [];
  ctx.session.inviteEphemeralIds = [...prev, messageId];
}

async function clearSignupEphemerals(ctx: BotContext): Promise<void> {
  if (!ctx.chat) return;
  for (const id of ctx.session.signupEphemeralIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.signupEphemeralIds = undefined;
}

async function clearInvitePrompt(ctx: BotContext): Promise<void> {
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

/** Chiude lo step invito opzionale senza rispostone (es. tap su Crea). */
export async function dismissInviteStep(ctx: BotContext): Promise<void> {
  if (!ctx.session.awaitingInviteCode) return;
  await clearInvitePrompt(ctx);
  ctx.session.awaitingInviteCode = undefined;
}

async function askForHandle(ctx: BotContext): Promise<void> {
  ctx.session.awaitingHandle = true;
  ctx.session.creating = undefined;
  ctx.session.termsQa = undefined;
  if (ctx.chat) {
    if (ctx.session.signupPromptMessageId != null) {
      await deleteMessageSafe(
        ctx.api,
        ctx.chat.id,
        ctx.session.signupPromptMessageId,
      );
    }
    await clearSignupEphemerals(ctx);
  }
  const msg = await ctx.reply(it.welcomeAskHandle, {
    parse_mode: "Markdown",
  });
  ctx.session.signupPromptMessageId = msg.message_id;
}

async function askInviteOptional(ctx: BotContext): Promise<void> {
  ctx.session.awaitingInviteCode = true;
  if (ctx.chat && ctx.session.invitePromptMessageId != null) {
    await deleteMessageSafe(
      ctx.api,
      ctx.chat.id,
      ctx.session.invitePromptMessageId,
    );
  }
  const msg = await ctx.reply(it.askInviteOptional);
  ctx.session.invitePromptMessageId = msg.message_id;
}

/** Payload `/start invito_CODE` o `invito CODE`. */
function parseStartInvitePayload(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  // /start INVITE_CODE or /start invito_CODE
  const payload = parts[1];
  if (!payload) return undefined;
  const m = payload.match(/^(?:invito[_-])?([A-Za-z0-9-]{4,24})$/i);
  if (!m) return undefined;
  return m[1]!.toUpperCase();
}

async function redeemInvite(
  ctx: BotContext,
  rawCode: string,
  opts?: { userMessageId?: number },
): Promise<boolean> {
  if (!ctx.from) return false;
  if (!ctx.members.isRegistered(ctx.from.id)) {
    await ctx.reply(it.needRegistration, { parse_mode: "Markdown" });
    return false;
  }

  const code = rawCode.trim().toUpperCase();
  if (!code || code.length < 4) {
    const msg = await ctx.reply(it.inviteUsage, { parse_mode: "Markdown" });
    trackInviteEphemeral(ctx, msg.message_id);
    return false;
  }

  const member = ctx.members.get(ctx.from.id);
  if (member?.inviteCode && member.inviteCode !== code) {
    const msg = await ctx.reply(it.inviteRedeemOther);
    trackInviteEphemeral(ctx, msg.message_id);
    return false;
  }
  if (member?.inviteCode === code) {
    await clearInvitePrompt(ctx);
    if (opts?.userMessageId != null && ctx.chat) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, opts.userMessageId);
    }
    ctx.session.awaitingInviteCode = undefined;
    ctx.session.pendingInviteCode = undefined;
    await ctx.reply(it.inviteRedeemAlready(code), { parse_mode: "Markdown" });
    return true;
  }

  const result = ctx.invites.redeem(code, ctx.from.id, ctx.from.username);
  if (!result.ok) {
    if (result.reason === "already_other") {
      const msg = await ctx.reply(it.inviteRedeemOther);
      trackInviteEphemeral(ctx, msg.message_id);
      return false;
    }
    const msg = await ctx.reply(it.inviteNotFound);
    trackInviteEphemeral(ctx, msg.message_id);
    if (opts?.userMessageId != null && ctx.chat) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, opts.userMessageId);
      trackInviteEphemeral(ctx, opts.userMessageId);
    }
    return false;
  }

  ctx.members.setInviteCode(ctx.from.id, result.invite.code);
  await clearInvitePrompt(ctx);
  if (opts?.userMessageId != null && ctx.chat) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, opts.userMessageId);
  }
  ctx.session.awaitingInviteCode = undefined;
  ctx.session.pendingInviteCode = undefined;

  if (result.already) {
    await ctx.reply(it.inviteRedeemAlready(result.invite.code), {
      parse_mode: "Markdown",
    });
    return true;
  }
  await ctx.reply(it.inviteRedeemOk(result.invite.code), {
    parse_mode: "Markdown",
  });
  return true;
}

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    // /start in gruppo arriva spesso da startgroup=payload
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      return;
    }

    if (!ctx.from) return;

    const inviteFromStart = parseStartInvitePayload(ctx.message?.text);
    if (inviteFromStart) {
      ctx.session.pendingInviteCode = inviteFromStart;
    }

    try {
      if (ctx.members.isRegistered(ctx.from.id)) {
        const member = ctx.members.touch(ctx.from.id, ctx.from.username);
        ctx.session.awaitingHandle = undefined;
        ctx.session.signupPromptMessageId = undefined;
        ctx.session.signupEphemeralIds = undefined;

        if (ctx.session.pendingInviteCode && !member.inviteCode) {
          await redeemInvite(ctx, ctx.session.pendingInviteCode);
        }

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

  bot.command("invito", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.onlyPrivate, { parse_mode: "Markdown" });
      return;
    }
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
    const code = parts[1];
    if (!code) {
      await ctx.reply(it.inviteUsage, { parse_mode: "Markdown" });
      return;
    }
    await redeemInvite(ctx, code, {
      userMessageId: ctx.message?.message_id,
    });
  });

  bot.command("skip", async (ctx) => {
    if (ctx.chat?.type !== "private" || !ctx.from) return;
    if (!ctx.session.awaitingInviteCode) return;

    const userMsgId = ctx.message?.message_id;
    await clearInvitePrompt(ctx);
    if (userMsgId != null && ctx.chat) {
      await deleteMessageSafe(ctx.api, ctx.chat.id, userMsgId);
    }
    ctx.session.awaitingInviteCode = undefined;
    await ctx.reply(it.inviteSkipped, { reply_markup: mainMenuKeyboard() });
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

  /**
   * Admin: crea codice invito collaboratore.
   * /codice <WALLET_SOL> <@user|userId> [CODICE]
   */
  bot.command(["codice", "invitecreate"], async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
    const wallet = (parts[1] ?? "").trim();
    const whoRaw = (parts[2] ?? "").trim();
    const customCode = (parts[3] ?? "").trim() || undefined;

    if (!wallet || !whoRaw || !isValidSolAddress(wallet)) {
      await ctx.reply(it.codiceUsage, { parse_mode: "Markdown" });
      return;
    }

    let collaboratorUserId: number | undefined;
    let collaboratorUsername: string | undefined;

    if (/^\d+$/.test(whoRaw)) {
      collaboratorUserId = Number(whoRaw);
      const m = ctx.members.get(collaboratorUserId);
      collaboratorUsername = m?.username;
    } else {
      const uname = whoRaw.replace(/^@+/, "");
      const m = ctx.members.findByUsername(uname);
      if (m) {
        collaboratorUserId = m.userId;
        collaboratorUsername = m.username;
      } else {
        // Collaboratore non ancora iscritto: accetta username, userId = 0 placeholder
        // Better: require numeric id if not registered
        await ctx.reply(
          `Utente *@${uname}* non in iscritti. Usa il *user id* numerico Telegram.\nEs: \`/codice ${wallet} 123456789\``,
          { parse_mode: "Markdown" },
        );
        return;
      }
    }

    if (collaboratorUserId == null || !Number.isFinite(collaboratorUserId)) {
      await ctx.reply(it.codiceUsage, { parse_mode: "Markdown" });
      return;
    }

    try {
      const invite = ctx.invites.create({
        collaboratorUserId,
        collaboratorUsername,
        collaboratorWallet: wallet,
        createdByAdminId: ctx.from.id,
        code: customCode,
      });
      const who = collaboratorUsername
        ? `@${collaboratorUsername}`
        : String(collaboratorUserId);
      await ctx.reply(it.codiceCreated(invite.code, invite.collaboratorWallet, who), {
        parse_mode: "Markdown",
      });
    } catch (err) {
      await ctx.reply(
        err instanceof Error ? err.message : "Creazione codice fallita.",
      );
    }
  });

  /** Admin: elenco codici. */
  bot.command(["codici", "invitelist"], async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    const list = ctx.invites.list(30);
    if (list.length === 0) {
      await ctx.reply(it.codiceListEmpty);
      return;
    }
    const lines = list.map((inv) => {
      const who = inv.collaboratorUsername
        ? `@${inv.collaboratorUsername}`
        : String(inv.collaboratorUserId);
      const n = inv.redemptions.length;
      const flag = inv.active ? "" : " [off]";
      return `• *${inv.code}*${flag} · ${who} · ${n} usi\n  \`${inv.collaboratorWallet}\``;
    });
    await ctx.reply(`${it.codiceListHeader(list.length)}\n\n${lines.join("\n")}`, {
      parse_mode: "Markdown",
    });
  });

  /** Admin: riepilogo fee da deal released. */
  bot.command(["fee", "feesummary"], async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    const all = [
      ...ctx.store.listByStatus("released"),
      ...ctx.store.listByStatus("refunded"),
    ];
    const released = all.filter((d) => d.status === "released");
    const refunded = all.filter((d) => d.status === "refunded");

    let platform = 0n;
    let collab = 0n;
    let seller = 0n;
    for (const d of released) {
      if (d.platformFeeLamports) platform += BigInt(d.platformFeeLamports);
      if (d.collaboratorFeeLamports) collab += BigInt(d.collaboratorFeeLamports);
      if (d.sellerPayoutLamports) seller += BigInt(d.sellerPayoutLamports);
    }

    const withInvite = released.filter((d) => d.inviteCode).length;
    const body = [
      it.feeSummaryHeader(released.length, refunded.length),
      `Con invito: *${withInvite}*`,
      `Fee piattaforma: *${lamportsToSolString(platform)} SOL*`,
      `Fee collaboratori: *${lamportsToSolString(collab)} SOL*`,
      `Payout seller: *${lamportsToSolString(seller)} SOL*`,
      "",
      it.feeDisclosureShort(),
    ].join("\n");
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

    // Dopo iscrizione: codice invito opzionale (testo libero)
    if (
      ctx.session.awaitingInviteCode &&
      ctx.members.isRegistered(ctx.from.id) &&
      !ctx.session.creating &&
      !ctx.session.termsQa
    ) {
      // Menu / wizard → chiudi invito silenzioso e lascia passare (no prompt stack)
      if (MENU_TEXTS.has(text)) {
        await dismissInviteStep(ctx);
        await next();
        return;
      }

      const maybe = text.replace(/^#/, "").trim();
      if (/^[A-Za-z0-9-]{4,24}$/.test(maybe)) {
        await redeemInvite(ctx, maybe, {
          userMessageId: ctx.message.message_id,
        });
        return;
      }

      // Testo non-codice: non riesporre il prompt; cancella solo la risposta
      await deleteMessageSafe(ctx.api, ctx.chat.id, ctx.message.message_id);
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
        const msg = await ctx.reply(it.handleNeedTelegramUsername, {
          parse_mode: "Markdown",
        });
        trackSignupEphemeral(ctx, msg.message_id);
        if (ctx.message?.message_id != null) {
          trackSignupEphemeral(ctx, ctx.message.message_id);
        }
        return;
      }
      if (result.reason === "mismatch") {
        const msg = await ctx.reply(it.handleMismatch(ctx.from.username), {
          parse_mode: "Markdown",
        });
        trackSignupEphemeral(ctx, msg.message_id);
        if (ctx.message?.message_id != null) {
          trackSignupEphemeral(ctx, ctx.message.message_id);
        }
        return;
      }
      // invalid: se non stiamo aspettando handle esplicitamente, passa oltre
      if (ctx.session.awaitingHandle) {
        const msg = await ctx.reply(it.handleInvalid, {
          parse_mode: "Markdown",
        });
        trackSignupEphemeral(ctx, msg.message_id);
        if (ctx.message?.message_id != null) {
          trackSignupEphemeral(ctx, ctx.message.message_id);
        }
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

    // Applica pending invite da /start, altrimenti chiedi codice opzionale una volta
    if (ctx.session.pendingInviteCode) {
      await redeemInvite(ctx, ctx.session.pendingInviteCode);
    } else if (!result.reconnected) {
      const m = ctx.members.get(ctx.from.id);
      if (!m?.inviteCode && !ctx.session.awaitingInviteCode) {
        await askInviteOptional(ctx);
      }
    }
  });
}
