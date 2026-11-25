import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  detectIdentityChange,
  isAdminUser,
  isParty,
} from "../services/deal-logic.js";
import { findDealForGroupChat } from "../services/group-chat-remap.js";
import {
  kickUnauthorized,
  refreshGroupSetupCard,
} from "../services/group-setup.js";

function isForwardedMessage(msg: {
  forward_origin?: unknown;
  forward_date?: number;
  forward_from?: unknown;
  forward_from_chat?: unknown;
  forward_sender_name?: string;
}): boolean {
  return Boolean(
    msg.forward_origin ||
      msg.forward_date ||
      msg.forward_from ||
      msg.forward_from_chat ||
      msg.forward_sender_name,
  );
}

function displayNameOf(user: {
  first_name?: string;
  last_name?: string;
}): string | undefined {
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Anti-scam stile CoinXpert (senza community):
 * - blocca / cancella forward nel gruppo deal
 * - rimuove bot non autorizzati
 * - avvisa su cambio nome/username delle parti
 */
export function registerGroupHygieneHandlers(bot: Bot<BotContext>): void {
  // Forward: elimina se possibile e avvisa (una volta per messaggio).
  bot.on("message", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }
    // Skip service migrate messages — handled in group-lifecycle.
    if (
      ctx.message &&
      ("migrate_to_chat_id" in ctx.message ||
        "migrate_from_chat_id" in ctx.message)
    ) {
      await next();
      return;
    }
    const deal = await findDealForGroupChat(
      ctx.api,
      ctx.store,
      ctx.chat.id,
      ctx.from?.id,
    );
    if (!deal || !ctx.message) {
      await next();
      return;
    }

    if (isForwardedMessage(ctx.message)) {
      try {
        await ctx.deleteMessage();
      } catch {
        // senza can_delete_messages non possiamo cancellare
      }
      await ctx.reply(it.forwardBlocked);
      return;
    }

    await next();
  });

  // Cambio identità + log testi umani (dispute / deleted-msg retention).
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }
    const deal = await findDealForGroupChat(
      ctx.api,
      ctx.store,
      ctx.chat.id,
      ctx.from?.id,
    );
    if (!deal || !ctx.from || ctx.from.is_bot) {
      await next();
      return;
    }

    // Retention: ogni testo umano nel gruppo deal (chat libera buyer↔seller,
    // comandi, non solo reply al bot) — prima che igiene/handler cancellino.
    // Admin /deal = solo [del]; /log = transcript. Cap in store.
    // TODO(poi): harden se le parti cancellano messaggi del bot in gruppo
    // (Bot API non notifica delete utente → pin/card possono sparire senza alert).
    if (
      deal.status !== "released" &&
      deal.status !== "refunded" &&
      deal.status !== "cancelled"
    ) {
      const text = ctx.message?.text?.trim() ?? "";
      if (text) {
        const role =
          deal.buyerId === ctx.from.id
            ? "buyer"
            : deal.sellerId === ctx.from.id
              ? "seller"
              : isAdminUser(ctx.from.id)
                ? "admin"
                : "other";
        ctx.dealLogs.appendUserMessage(deal.id, {
          text,
          fromId: ctx.from.id,
          username: ctx.from.username,
          role,
          messageId: ctx.message?.message_id,
        });
      }
    }

    // Identity alerts solo per le parti assegnate.
    if (!isParty(deal, ctx.from.id)) {
      await next();
      return;
    }

    const detected = detectIdentityChange(
      deal,
      ctx.from.id,
      ctx.from.username,
      displayNameOf(ctx.from),
    );
    if (detected) {
      const updated = ctx.store.update(deal.id, detected.patch) ?? deal;
      if (
        detected.patch.buyerUsername != null ||
        detected.patch.sellerUsername != null
      ) {
        await refreshGroupSetupCard(ctx.api, ctx.store, updated).catch(
          () => undefined,
        );
      }
      if (detected.alert) {
        const who =
          deal.buyerId === ctx.from.id
            ? "Buyer"
            : deal.sellerId === ctx.from.id
              ? "Seller"
              : "Parte";
        await ctx.reply(it.identityChanged(who, detected.alert), {
          parse_mode: "Markdown",
        });
      }
    }

    await next();
  });
}

/** Kick bot estranei (non il bot stesso) in un gruppo deal. */
export async function kickUnauthorizedBot(
  ctx: BotContext,
  chatId: number,
  user: { id: number; is_bot?: boolean; username?: string },
): Promise<boolean> {
  if (!user.is_bot) return false;
  const me = await ctx.api.getMe();
  if (user.id === me.id) return false;

  const deal = ctx.store.findByGroupChatId(chatId);
  if (!deal) return false;

  await kickUnauthorized(ctx.api, chatId, user.id, {
    notice: it.kickedUnauthorizedBot(user.username),
  });
  return true;
}
