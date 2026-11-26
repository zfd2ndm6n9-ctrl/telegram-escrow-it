import type { Bot } from "grammy";
import { PublicKey } from "@solana/web3.js";
import type { BotContext } from "../context.js";
import { isAdminUser } from "../services/deal-logic.js";
import { formatDealEvidenceFacts, it } from "../messages/it.js";
import { replyWithMainMenu } from "../services/dm-hygiene.js";
import { publishIscrittiCount } from "../services/public-count.js";
import { registerHandleFromMessage } from "../services/registration.js";
import { deleteMessageSafe } from "../services/prompt-cleanup.js";
import {
  clearInvitePrompt,
  trackInviteEphemeral,
} from "../services/invite-step.js";
import {
  getEscrowBalanceLamports,
  getSolanaConnection,
  isSolanaConfigured,
  isValidSolAddress,
  lamportsToSolString,
} from "../services/solana/index.js";
import {
  checkVouchMembership,
  vouchInviteLink,
  vouchJoinKeyboard,
} from "../services/vouch-membership.js";
import { ensureVouchTosPin } from "../services/vouch-tos-pin.js";
import { config } from "../config.js";
import { beginCreateDealFlow } from "./create-deal.js";

// Re-export per callers legacy
export { dismissInviteStep } from "../services/invite-step.js";

function trackSignupEphemeral(ctx: BotContext, messageId: number): void {
  const prev = ctx.session.signupEphemeralIds ?? [];
  ctx.session.signupEphemeralIds = [...prev, messageId];
}

async function clearSignupEphemerals(ctx: BotContext): Promise<void> {
  if (!ctx.chat) return;
  for (const id of ctx.session.signupEphemeralIds ?? []) {
    await deleteMessageSafe(ctx.api, ctx.chat.id, id);
  }
  ctx.session.signupEphemeralIds = undefined;
}

/** Payload `/start crea` → avvia wizard dopo iscrizione/vouch. */
function parseStartCreaPayload(text: string | undefined): boolean {
  if (!text) return false;
  const parts = text.trim().split(/\s+/);
  const payload = (parts[1] ?? "").trim().toLowerCase();
  return payload === "crea" || payload === "create";
}

/** Payload `/start deal_HEX` — deep-link admin dopo disputa (DM fallita). */
function parseStartDealPayload(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  const payload = (parts[1] ?? "").trim();
  const m = payload.match(/^deal[_-]?([a-fA-F0-9]{8})$/i);
  return m ? m[1]!.toLowerCase() : undefined;
}

/** Payload `/start invito_CODE` o `invito CODE`. */
function parseStartInvitePayload(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const parts = text.trim().split(/\s+/);
  // /start INVITE_CODE or /start invito_CODE (not crea)
  const payload = parts[1];
  if (!payload) return undefined;
  if (/^(crea|create)$/i.test(payload)) return undefined;
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
    // Silenzioso: niente «Codice … già attivo» in DM.
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

  // Silenzioso in DM: il codice compare sulla card pinnata del deal in gruppo.
  void result.already;
  return true;
}

/**
 * /start: iscrizione (con o senza @) + check canale vouch + welcome.
 * Hard gate vouch: senza membership niente menu /crea.
 * Invito opzionale: solo su /crea (non qui).
 */
async function completeStart(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const wasRegistered = ctx.members.isRegistered(ctx.from.id);
  const result = ctx.members.registerFromStart(
    ctx.from.id,
    ctx.from.username,
  );

  if (result.previousUserId != null) {
    const remapped = ctx.store.remapUserId(
      result.previousUserId,
      ctx.from.id,
    );
    console.log(
      `Riconnessione userId ${result.previousUserId} → ${ctx.from.id}, deal=${remapped}`,
    );
  }

  // /start fresco: chiudi eventuale step invito di un /crea interrotto
  await clearInvitePrompt(ctx);
  ctx.session.awaitingInviteCode = undefined;
  // pendingInviteCode resta se impostato dal payload /start invito_CODE
  // pendingCrea resta se /start crea

  ctx.session.awaitingHandle = undefined;
  ctx.session.signupPromptMessageId = undefined;
  await clearSignupEphemerals(ctx);

  if (result.isNew && !wasRegistered) {
    await publishIscrittiCount(ctx.api, ctx.members.registeredCount);
  }

  const vouch = await checkVouchMembership(ctx.api, ctx.from.id);
  const welcome = result.reconnected || wasRegistered
    ? it.welcomeBack(result.member.username)
    : it.registeredOk(result.member.username);

  if (vouch.ok && vouch.member) {
    await replyWithMainMenu(ctx, welcome, { parse_mode: "Markdown" });
    // Deep-link /start crea → wizard (invito chiesto lì)
    if (ctx.session.pendingCrea) {
      ctx.session.pendingCrea = undefined;
      await beginCreateDealFlow(ctx);
    }
    // pendingInviteCode: applicato al prossimo /crea (niente ask qui)
    console.log(
      `/start ok chat=${ctx.chat?.id} from=${ctx.from.id} vouch=in iscritti=${ctx.members.registeredCount}`,
    );
    return;
  }

  // Fuori dal canale (o check fallito): prompt join, niente menu /crea
  const joinMsg = await ctx.reply(it.needVouchJoin(vouchInviteLink()), {
    parse_mode: "Markdown",
    reply_markup: vouchJoinKeyboard(),
    link_preview_options: { is_disabled: true },
  });
  trackSignupEphemeral(ctx, joinMsg.message_id);

  // Soft remind @ sotto (secondario)
  if (!result.member.username) {
    const soft = await ctx.reply(it.needUsernameSoft, {
      parse_mode: "Markdown",
    });
    trackSignupEphemeral(ctx, soft.message_id);
  }

  console.log(
    `/start ok chat=${ctx.chat?.id} from=${ctx.from.id} vouch=out iscritti=${ctx.members.registeredCount}`,
  );
}

/**
 * DM admin: fatti card + messaggi cancellati/cleared + media silent-log.
 * Condiviso da `/deal`, deal-id nudo e `/start deal_HEX`.
 * Chat viva → gruppo in Archiviati. `/log` resta il transcript completo.
 */
async function replyAdminDealDm(
  ctx: BotContext,
  dealId: string,
): Promise<void> {
  const deal = ctx.store.get(dealId);
  if (!deal) {
    await ctx.reply(it.dealAdminUnknown(dealId), { parse_mode: "Markdown" });
    return;
  }
  ctx.dealLogs.pruneExpired();
  const evidence = ctx.dealLogs.getAdminDealEvidenceEntries(dealId);
  const facts = formatDealEvidenceFacts(deal);
  const header = it.dealAdminHeader(dealId, evidence.length);
  const transcript = ctx.dealLogs.formatAdminDealEvidence(dealId);
  const chatBlock = transcript
    ? `${it.dealAdminDeletedTitle}\n${transcript}`
    : it.dealAdminNoDeleted(dealId);
  const head = `${it.dealAdminFactsTitle}\n${facts}\n\n${header}`;
  const full = `${head}\n\n${chatBlock}`;
  if (full.length <= 3900) {
    await ctx.reply(full, { parse_mode: "Markdown" });
    return;
  }
  await ctx.reply(head, { parse_mode: "Markdown" });
  if (transcript) {
    await ctx.reply(it.dealAdminDeletedTitle, { parse_mode: "Markdown" });
    for (let i = 0; i < transcript.length; i += 3500) {
      await ctx.reply(transcript.slice(i, i + 3500));
    }
  } else {
    await ctx.reply(it.dealAdminNoDeleted(dealId), { parse_mode: "Markdown" });
  }
}

export function registerStartHandlers(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    // /start in gruppo arriva spesso da startgroup=payload
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      return;
    }

    if (!ctx.from) return;

    // Deep-link disputa: admin apre chat col bot → stato deal subito.
    const dealFromStart = parseStartDealPayload(ctx.message?.text);
    if (dealFromStart && isAdminUser(ctx.from.id)) {
      await replyAdminDealDm(ctx, dealFromStart);
      return;
    }

    if (parseStartCreaPayload(ctx.message?.text)) {
      ctx.session.pendingCrea = true;
    }
    const inviteFromStart = parseStartInvitePayload(ctx.message?.text);
    if (inviteFromStart) {
      ctx.session.pendingInviteCode = inviteFromStart;
    }

    try {
      await completeStart(ctx);
    } catch (err) {
      console.error(
        `/start fail chat=${ctx.chat?.id} from=${ctx.from.id}:`,
        err instanceof Error ? err.message : err,
      );
      throw err;
    }
  });

  /** Dopo join canale vouch: ricontrolla membership. */
  bot.callbackQuery("vouch_joined", async (ctx) => {
    if (!ctx.from || ctx.chat?.type !== "private") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery({ text: "Verifico…" });

    const vouch = await checkVouchMembership(ctx.api, ctx.from.id);
    if (vouch.ok && vouch.member) {
      await clearSignupEphemerals(ctx);
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      } catch {
        // ok
      }
      const member = ctx.members.touch(ctx.from.id, ctx.from.username);
      await replyWithMainMenu(
        ctx,
        `${it.vouchJoinedOk}\n\n${it.welcomeBack(member.username)}`,
        { parse_mode: "Markdown" },
      );
      // pendingInviteCode resta per il prossimo /crea
      if (ctx.session.pendingCrea && ctx.members.isRegistered(ctx.from.id)) {
        ctx.session.pendingCrea = undefined;
        await beginCreateDealFlow(ctx);
      }
      return;
    }

    const msg = await ctx.reply(it.vouchStillOut(vouchInviteLink()), {
      parse_mode: "Markdown",
      reply_markup: vouchJoinKeyboard(),
      link_preview_options: { is_disabled: true },
    });
    trackSignupEphemeral(ctx, msg.message_id);
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

  /**
   * Admin DM: transcript messaggi parte + eventi chiave per dispute.
   * Uso: /log #250538a0 | /log 250538a0
   */
  bot.command("log", async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Usa `/log` in privato col bot.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const raw = (ctx.message?.text ?? "").trim();
    const m = raw.match(/^\/log(?:@\w+)?\s+#?([a-fA-F0-9]{8})\b/);
    const dealId = (m?.[1] ?? "").toLowerCase();
    if (!dealId) {
      await ctx.reply(it.logUsage, { parse_mode: "Markdown" });
      return;
    }
    ctx.dealLogs.pruneExpired();
    const body = ctx.dealLogs.formatTranscript(dealId);
    if (!body) {
      await ctx.reply(it.logEmpty(dealId), { parse_mode: "Markdown" });
      return;
    }
    const entries = ctx.dealLogs.getEntries(dealId);
    const header = it.logHeader(dealId, entries.length);
    const full = `${header}\n\n${body}`;
    // Telegram hard limit ~4096; spezza se serve.
    if (full.length <= 3900) {
      await ctx.reply(full, { parse_mode: "Markdown" });
      return;
    }
    await ctx.reply(header, { parse_mode: "Markdown" });
    for (let i = 0; i < body.length; i += 3500) {
      await ctx.reply(body.slice(i, i + 3500));
    }
  });

  /**
   * Admin DM: evidence pack — fatti card + [del] + media silent-log.
   * Uso: /deal 250538a0 | /deal #250538a0 | id nudo | deep-link /start deal_HEX
   * Transcript completo: `/log`. Chat viva: gruppo Archiviati (cerca #id).
   */
  bot.command("deal", async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Usa `/deal` in privato col bot.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const raw = (ctx.message?.text ?? "").trim();
    const m = raw.match(/^\/deal(?:@\w+)?\s+#?([a-fA-F0-9]{8})\b/);
    const dealId = (m?.[1] ?? "").toLowerCase();
    if (!dealId) {
      await ctx.reply(it.dealAdminUsage, { parse_mode: "Markdown" });
      return;
    }
    await replyAdminDealDm(ctx, dealId);
  });

  /**
   * Admin: unico modo per creare/sostituire il teaser ToS sul canale vouch.
   * Soft-fail se mancano VOUCH_CHANNEL_ID, PUBLIC_BASE_URL o permessi post/pin.
   * Il boot soft non posta: solo `/pin_tos` (force) crea o aggiorna.
   */
  bot.command(["pin_tos", "pintos"], async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Usa `/pin_tos` in privato col bot.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const result = await ensureVouchTosPin(ctx.api, { force: true });
    if (result.ok) {
      await ctx.reply(
        `✅ ToS sul canale vouch: messaggio \`${result.messageId}\`` +
          (result.reused ? " (riuso)" : " (nuovo)") +
          ` · ${result.via}` +
          (config.tosWebAppUrl ? `\n${config.tosWebAppUrl}` : ""),
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
      );
      return;
    }
    const hints: Record<string, string> = {
      no_channel: "Imposta `VOUCH_CHANNEL_ID` (bot admin del canale).",
      no_tos_url:
        "Imposta `PUBLIC_BASE_URL` (URL HTTPS del Web Service) o `TOS_URL`.",
      no_state:
        "Nessun pin tracciato in DATA_DIR (non dovrebbe succedere con force).",
      post_failed:
        "Post fallito: il bot serve permesso di pubblicare nel canale.",
      pin_failed:
        "Messaggio pubblicato ma pin fallito: serve permesso «Fissa messaggi».",
    };
    await ctx.reply(
      `⚠️ \`/pin_tos\`: ${hints[result.reason] ?? result.reason}` +
        (result.detail ? `\n\`${result.detail}\`` : ""),
      { parse_mode: "Markdown" },
    );
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
      let warn = "";
      try {
        if (isSolanaConfigured()) {
          const info = await getSolanaConnection().getAccountInfo(
            new PublicKey(wallet),
          );
          if (info == null) {
            warn =
              "\n\n⚠️ Wallet collab *non attivo* on-chain (0 SOL). " +
              "Finanzia con ≥ ~0.001 SOL prima di deal piccoli, " +
              "altrimenti il 2.5% viene piegato sull'admin alla release.";
          }
        }
      } catch {
        // soft: creazione codice ok anche se RPC fallisce
      }
      await ctx.reply(
        it.codiceCreated(invite.code, invite.collaboratorWallet, who) + warn,
        { parse_mode: "Markdown" },
      );
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

  /**
   * Admin: svuota deals.json + deal-logs.json (soft-launch cleanup).
   * Non tocca members/invites/vouch pin. Non sposta fondi on-chain.
   * Uso: /admin_wipe_deals | /admin_wipe_deals CONFERMA | … CONFERMA FORCE
   */
  bot.command(["admin_wipe_deals", "adminwipedeals"], async (ctx) => {
    if (!ctx.from || !isAdminUser(ctx.from.id)) {
      await ctx.reply(it.adminOnly);
      return;
    }
    if (ctx.chat?.type !== "private") {
      await ctx.reply("Usa `/admin_wipe_deals` in privato col bot.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const parts = (ctx.message?.text ?? "").trim().split(/\s+/);
    const arg1 = (parts[1] ?? "").trim().toUpperCase();
    const arg2 = (parts[2] ?? "").trim().toUpperCase();
    const confirm = arg1 === "CONFERMA" || arg1 === "CONFIRM";
    const force = arg2 === "FORCE" || arg1 === "FORCE";

    if (arg1 && !confirm && arg1 !== "FORCE") {
      await ctx.reply(it.adminWipeUsage, { parse_mode: "Markdown" });
      return;
    }

    const all = ctx.store.listAll();
    const fundedLines: string[] = [];
    let checkErrors = 0;

    // Cap RPC: soft-launch store piccolo; evita hammer se migliaia di deal.
    const toCheck = all.slice(0, 80);
    for (const d of toCheck) {
      const addr = d.escrowAddress?.trim();
      if (!addr || addr === "PENDING_SOL_ESCROW" || !isValidSolAddress(addr)) {
        continue;
      }
      try {
        const bal = await getEscrowBalanceLamports(addr);
        if (bal > 0n) {
          fundedLines.push(
            `• *#${d.id}* \`${lamportsToSolString(bal)} SOL\` · \`${addr}\``,
          );
        }
      } catch {
        checkErrors += 1;
      }
    }
    if (all.length > toCheck.length) {
      checkErrors += 1; // segnala check parziale
    }

    if (!confirm) {
      await ctx.reply(
        it.adminWipePreview({
          dealCount: all.length,
          logBuckets: ctx.dealLogs.size,
          fundedLines: fundedLines.slice(0, 15),
          checkErrors,
        }),
        { parse_mode: "Markdown" },
      );
      return;
    }

    if ((fundedLines.length > 0 || checkErrors > 0) && !force) {
      await ctx.reply(
        `${it.adminWipeNeedForce}\n\n${it.adminWipePreview({
          dealCount: all.length,
          logBuckets: ctx.dealLogs.size,
          fundedLines: fundedLines.slice(0, 15),
          checkErrors,
        })}`,
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Prima di clearAll: avvisa + leave gruppi leftover (evita card orfane → Bug A).
    const groupIds = [
      ...new Set(
        all
          .map((d) => d.groupChatId)
          .filter((id): id is number => id != null),
      ),
    ];
    let leftGroups = 0;
    for (const chatId of groupIds) {
      try {
        await ctx.api.sendMessage(chatId, it.groupWipedNotice, {
          parse_mode: "Markdown",
        });
      } catch {
        // ok se già fuori / chat morta
      }
      try {
        await ctx.api.leaveChat(chatId);
        leftGroups += 1;
      } catch {
        // ok
      }
    }

    const dealsRemoved = ctx.store.clearAll();
    const logsRemoved = ctx.dealLogs.clearAll();
    console.warn(
      `[admin_wipe_deals] by ${ctx.from.id}: removed ${dealsRemoved} deals, ${logsRemoved} log buckets, left ${leftGroups}/${groupIds.length} groups` +
        (force ? " (FORCE)" : ""),
    );
    await ctx.reply(
      `${it.adminWipeDone(dealsRemoved, logsRemoved)}\nGruppi lasciati: *${leftGroups}/${groupIds.length}*.`,
      { parse_mode: "Markdown" },
    );
  });

  /**
   * Path legacy «invia @» (solo se awaitingHandle).
   * Invito opzionale: gestito in create-deal (ogni /crea).
   */
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

    // Admin: deal id nudo (8 hex) → stesso evidence pack di `/deal`.
    const bareDeal = text.match(/^#?([a-fA-F0-9]{8})$/);
    if (bareDeal && isAdminUser(ctx.from.id)) {
      await replyAdminDealDm(ctx, bareDeal[1]!.toLowerCase());
      return;
    }

    // Step invito /crea → lascia a create-deal
    if (ctx.session.awaitingInviteCode || ctx.session.creating?.step === "invite") {
      await next();
      return;
    }

    // Legacy / opzionale: utente senza @ che la reinvia dopo averla impostata
    if (!ctx.session.awaitingHandle) {
      await next();
      return;
    }
    if (ctx.session.creating || ctx.session.termsQa) {
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
      const msg = await ctx.reply(it.handleInvalid, {
        parse_mode: "Markdown",
      });
      trackSignupEphemeral(ctx, msg.message_id);
      if (ctx.message?.message_id != null) {
        trackSignupEphemeral(ctx, ctx.message.message_id);
      }
      return;
    }

    await replyWithMainMenu(ctx, it.welcomeBack(result.username), {
      parse_mode: "Markdown",
    });
  });
}
