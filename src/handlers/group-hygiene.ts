import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";
import {
  detectIdentityChange,
  isParty,
} from "../services/deal-logic.js";
import { kickUnauthorized } from "../services/group-setup.js";

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
    const deal = ctx.store.findByGroupChatId(ctx.chat.id);
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

  // Cambio identità: su ogni messaggio di testo da una parte.
  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
      await next();
      return;
    }
    const deal = ctx.store.findByGroupChatId(ctx.chat.id);
    if (!deal || !ctx.from || ctx.from.is_bot) {
      await next();
      return;
    }
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
      ctx.store.update(deal.id, detected.patch);
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
