import type { BotContext } from "../context.js";
import { it } from "../messages/it.js";

/**
 * Gate iscrizione: se l'utente non ha fatto /start in privato, risponde
 * e restituisce false. Non usare su my_chat_member / setup admin del bot.
 */
export async function requireRegistered(ctx: BotContext): Promise<boolean> {
  if (!ctx.from) return false;
  if (ctx.members.isRegistered(ctx.from.id)) return true;
  await ctx.reply(it.needPrivateStart, { parse_mode: "Markdown" });
  return false;
}
