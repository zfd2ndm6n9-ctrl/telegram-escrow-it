import type { Bot } from "grammy";
import type { BotContext } from "../context.js";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import {
  afterAmountKeyboard,
  assetKeyboard,
  cancelKeyboard,
  groupInviteKeyboard,
  mainMenuKeyboard,
  roleKeyboard,
} from "../keyboards/menus.js";
import { parseAmount } from "../services/deal-logic.js";
import {
  createEscrowGroup,
  groupCreatorReady,
} from "../services/group-creator.js";
import { startDealInGroup } from "../services/group-setup.js";
import {
  getDealEscrowAddress,
  isSolanaConfigured,
} from "../services/solana/index.js";
import type { Asset, PartyRole } from "../types.js";

function botCreatesGroupsEnabled(): boolean {
  return config.telegramBotCreatesGroups && groupCreatorReady();
}

export function registerCreateDealHandlers(bot: Bot<BotContext>): void {
  const beginCreate = async (ctx: BotContext) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply(it.onlyPrivate, { parse_mode: "Markdown" });
      return;
    }
    if (!isSolanaConfigured()) {
      await ctx.reply(it.solanaNotConfigured);
      return;
    }
    ctx.session.creating = { step: "role" };
    await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
  };

  bot.command("crea", beginCreate);
  bot.command("create", beginCreate);
  bot.hears("➕ Crea escrow", beginCreate);

  bot.hears("❌ Annulla", async (ctx) => {
    if (ctx.chat?.type !== "private") return;
    ctx.session.creating = undefined;
    await ctx.reply(it.cancelled, { reply_markup: mainMenuKeyboard() });
  });

  bot.hears("🛒 Sono il buyer", async (ctx) => {
    await pickRole(ctx, "buyer");
  });

  bot.hears("🏪 Sono il seller", async (ctx) => {
    await pickRole(ctx, "seller");
  });

  bot.hears("◎ SOL", async (ctx) => {
    await pickAsset(ctx, "SOL");
  });

  bot.hears("ETH (presto)", async (ctx) => {
    await assetComingSoon(ctx, "ETH");
  });

  bot.hears("LTC (presto)", async (ctx) => {
    await assetComingSoon(ctx, "LTC");
  });

  bot.callbackQuery("tos", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "ToS in arrivo" });
    await ctx.reply(it.tosComingSoon, { parse_mode: "Markdown" });
  });

  bot.on("message:text", async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      await next();
      return;
    }

    const creating = ctx.session.creating;
    if (!creating || !ctx.from) {
      await next();
      return;
    }

    const text = ctx.message.text.trim();
    if (text.startsWith("/")) {
      await next();
      return;
    }

    if (creating.step === "role") {
      await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
      return;
    }

    if (creating.step === "asset") {
      await ctx.reply(it.askAsset, { reply_markup: assetKeyboard() });
      return;
    }

    if (creating.step === "amount") {
      const amount = parseAmount(text);
      if (!amount) {
        await ctx.reply(it.invalidAmount, {
          parse_mode: "Markdown",
          reply_markup: cancelKeyboard(),
        });
        return;
      }

      const role = creating.role;
      if (!role) {
        ctx.session.creating = { step: "role" };
        await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
        return;
      }

      const asset = creating.asset;
      if (!asset || asset !== "SOL") {
        ctx.session.creating = { step: "asset", role };
        await ctx.reply(it.askAsset, { reply_markup: assetKeyboard() });
        return;
      }

      const placeholder = "PENDING_SOL_ESCROW";
      const creatorDisplayName = [ctx.from.first_name, ctx.from.last_name]
        .filter(Boolean)
        .join(" ");
      const deal = ctx.store.create({
        creatorId: ctx.from.id,
        creatorUsername: ctx.from.username,
        creatorDisplayName: creatorDisplayName || undefined,
        creatorRole: role,
        amount,
        asset,
        escrowAddress: placeholder,
      });

      const escrowAddress = await getDealEscrowAddress(deal.id);
      if (!escrowAddress) {
        ctx.store.setStatus(deal.id, "cancelled");
        ctx.session.creating = undefined;
        await ctx.reply(it.solanaNotConfigured);
        return;
      }

      const updated = ctx.store.update(deal.id, { escrowAddress })!;
      ctx.session.creating = undefined;

      // Opzionale: TELEGRAM_BOT_CREATES_GROUPS=1 + helper MTProto.
      if (botCreatesGroupsEnabled()) {
        const created = await createEscrowGroup({
          deal: updated,
          botApi: ctx.api,
          creatorId: ctx.from.id,
          creatorUsername: ctx.from.username,
        });

        if (created.ok) {
          const withGroup =
            ctx.store.update(updated.id, {
              groupChatId: created.chatId,
              groupInviteLink: created.inviteLink,
            }) ?? updated;

          const { deal: started, perms } = await startDealInGroup(
            ctx.api,
            ctx.store,
            withGroup,
            created.chatId,
          );

          if (!perms.ok) {
            await ctx.reply(it.missingBotPerms(perms.missing), {
              parse_mode: "Markdown",
              reply_markup: groupInviteKeyboard(
                created.inviteLink,
                config.tosUrl,
              ),
            });
            return;
          }

          await ctx.reply(
            it.groupReady(started, created.inviteLink, created.creatorInvited),
            {
              parse_mode: "Markdown",
              reply_markup: groupInviteKeyboard(
                created.inviteLink,
                config.tosUrl,
              ),
            },
          );
          return;
        }

        // Soft-fallback: istruzioni manuali se create automatica fallisce.
        await ctx.reply(it.afterAmountInstructions(updated), {
          parse_mode: "Markdown",
          reply_markup: afterAmountKeyboard(config.tosUrl),
        });
        await ctx.reply(it.groupCreateFailed(updated, created.error), {
          parse_mode: "Markdown",
          reply_markup: mainMenuKeyboard(),
        });
        return;
      }

      // Path felice (default): gruppo manuale.
      await ctx.reply(it.afterAmountInstructions(updated), {
        parse_mode: "Markdown",
        reply_markup: afterAmountKeyboard(config.tosUrl),
      });
    }
  });
}

async function pickRole(ctx: BotContext, role: PartyRole): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  if (!ctx.session.creating || ctx.session.creating.step !== "role") {
    ctx.session.creating = { step: "role" };
  }
  ctx.session.creating = { step: "asset", role };
  await ctx.reply(it.askAsset, { reply_markup: assetKeyboard() });
}

async function pickAsset(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private" || !ctx.from) return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset" || !creating.role) {
    ctx.session.creating = { step: "role" };
    await ctx.reply(it.askRole, { reply_markup: roleKeyboard() });
    return;
  }
  ctx.session.creating = { step: "amount", role: creating.role, asset };
  await ctx.reply(it.askAmount, {
    parse_mode: "Markdown",
    reply_markup: cancelKeyboard(),
  });
}

async function assetComingSoon(ctx: BotContext, asset: Asset): Promise<void> {
  if (ctx.chat?.type !== "private") return;
  const creating = ctx.session.creating;
  if (!creating || creating.step !== "asset") {
    return;
  }
  await ctx.reply(it.assetComingSoon(asset), {
    parse_mode: "Markdown",
    reply_markup: assetKeyboard(),
  });
}
