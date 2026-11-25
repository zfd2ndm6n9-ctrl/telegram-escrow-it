import type { Api as GrammyApi } from "grammy";
import { Api } from "teleproto";
import type { Deal } from "../types.js";
import { it } from "../messages/it.js";
import { config } from "../config.js";
import {
  channelToBotApiChatId,
  extractCreatedChannel,
  getMtprotoHelper,
  isMtprotoHelperConfigured,
} from "./mtproto-helper.js";

/**
 * Bot API hard limit: there is no createChat / createChannel / createGroup.
 * Ownership cannot be transferred to a bot. See docs/bot-owned-groups.md (store)
 * and docs/bot-created-groups.md (repo).
 */
export const BOT_API_CAN_CREATE_GROUPS = false;

/** Diritti admin utili al bot escrow (promote = demote party admins). */
export const BOT_ADMIN_RIGHTS = new Api.ChatAdminRights({
  changeInfo: true,
  postMessages: true,
  editMessages: true,
  deleteMessages: true,
  banUsers: true,
  inviteUsers: true,
  pinMessages: true,
  /** Serve a demoteChatMember / promoteChatMember(false) sulle parti. */
  addAdmins: true,
  anonymous: false,
  manageCall: true,
  other: true,
  manageTopics: true,
  postStories: false,
  editStories: false,
  deleteStories: false,
});

/**
 * Default banned rights per i membri umani.
 * `true` = azione vietata. Lasciamo messaggi/testo per ToS e wallet.
 */
export const MEMBER_DEFAULT_BANNED = new Api.ChatBannedRights({
  viewMessages: false,
  sendMessages: false,
  sendMedia: false,
  sendStickers: true,
  sendGifs: true,
  sendGames: true,
  sendInline: true,
  embedLinks: true,
  sendPolls: true,
  changeInfo: true,
  inviteUsers: true,
  pinMessages: true,
  manageTopics: true,
  sendPhotos: false,
  sendVideos: true,
  sendRoundvideos: true,
  sendAudios: true,
  sendVoices: true,
  sendDocs: false,
  sendPlain: false,
  untilDate: 0,
});

/** Specchio Bot API di MEMBER_DEFAULT_BANNED (dopo che il bot è admin). */
export const BOT_API_MEMBER_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: false,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
} as const;

/** Diritti tutti false → demote ad admin “vuoto” / membro. */
const DEMOTE_RIGHTS = {
  can_manage_chat: false,
  can_change_info: false,
  can_delete_messages: false,
  can_invite_users: false,
  can_restrict_members: false,
  can_pin_messages: false,
  can_promote_members: false,
  can_manage_video_chats: false,
  can_manage_topics: false,
  is_anonymous: false,
} as const;

export type CreateEscrowGroupResult =
  | {
      ok: true;
      chatId: number;
      /** Link per il creator del deal (member_limit 1). */
      creatorInviteLink: string;
      /** Link per la controparte (member_limit 1). */
      counterpartInviteLink: string;
      /** @deprecated alias di creatorInviteLink (compat UI). */
      inviteLink: string;
      creatorInvited: boolean;
      ownership: "helper";
    }
  | { ok: false; error: string; reason: "bot_api_impossible" | "helper_missing" | "create_failed" };

export function groupCreatorReady(): boolean {
  return isMtprotoHelperConfigured() && Boolean(config.botUsername);
}

/**
 * Feasible create paths (ordered):
 * 1. Bot API — impossible (`BOT_API_CAN_CREATE_GROUPS === false`).
 * 2. MTProto helper `channels.createChannel` megagroup — only real path.
 *
 * Helper = owner (not a deal party) → bot strong admin → restricted members →
 * dual invite links (creator + counterpart).
 */
export async function createEscrowGroup(input: {
  deal: Deal;
  botApi: GrammyApi;
  creatorId: number;
  creatorUsername?: string;
}): Promise<CreateEscrowGroupResult> {
  if (!BOT_API_CAN_CREATE_GROUPS) {
    // Explicit: no Bot API attempt — method does not exist.
  }

  if (!isMtprotoHelperConfigured()) {
    return {
      ok: false,
      reason: "helper_missing",
      error:
        "Bot API non può creare gruppi. Manca helper MTProto (TELEGRAM_API_ID/HASH + TELEGRAM_HELPER_SESSION).",
    };
  }

  const botUsername = config.botUsername;
  if (!botUsername) {
    return {
      ok: false,
      reason: "create_failed",
      error: "Username bot sconosciuto.",
    };
  }

  try {
    const client = await getMtprotoHelper();
    const title = it.groupTitle(input.deal);

    const created = await client.invoke(
      new Api.channels.CreateChannel({
        title,
        about: `Escrowita deal #${input.deal.id}`,
        megagroup: true,
      }),
    );

    const channel = extractCreatedChannel(created);
    if (!channel) {
      return {
        ok: false,
        reason: "create_failed",
        error: "Gruppo creato ma id chat non trovato.",
      };
    }

    const chatId = channelToBotApiChatId(channel);

    // Bot admin con diritti forti (in megagroup i bot entrano solo come admin).
    await client.invoke(
      new Api.channels.EditAdmin({
        channel,
        userId: botUsername.startsWith("@") ? botUsername : `@${botUsername}`,
        adminRights: BOT_ADMIN_RIGHTS,
        rank: "Escrowita",
      }),
    );

    try {
      await client.invoke(
        new Api.messages.EditChatDefaultBannedRights({
          peer: channel,
          bannedRights: MEMBER_DEFAULT_BANNED,
        }),
      );
    } catch (err) {
      console.warn("default banned rights via MTProto failed:", err);
    }

    try {
      await input.botApi.setChatPermissions(chatId, BOT_API_MEMBER_PERMISSIONS);
    } catch (err) {
      console.warn("setChatPermissions failed:", err);
    }

    let creatorInvited = false;
    const inviteTarget =
      input.creatorUsername != null && input.creatorUsername.length > 0
        ? input.creatorUsername
        : undefined;

    if (inviteTarget) {
      try {
        await client.invoke(
          new Api.channels.InviteToChannel({
            channel,
            users: [inviteTarget],
          }),
        );
        creatorInvited = true;
      } catch (err) {
        console.warn(
          `Invite creator @${inviteTarget} failed (userà il link):`,
          err,
        );
      }
    }

    const creatorInviteLink = await exportPartyInviteLink(
      input.botApi,
      client,
      channel,
      chatId,
      `deal-${input.deal.id}-a`,
    );
    const counterpartInviteLink = await exportPartyInviteLink(
      input.botApi,
      client,
      channel,
      chatId,
      `deal-${input.deal.id}-b`,
    );

    if (!creatorInviteLink || !counterpartInviteLink) {
      return {
        ok: false,
        reason: "create_failed",
        error: "Gruppo creato ma impossibile generare i link invito.",
      };
    }

    try {
      await input.botApi.setChatTitle(chatId, title);
    } catch {
      // ok
    }

    // Demote eventuali admin umani subito (parti non devono restare admin).
    await demoteNonOwnerHumanAdmins(input.botApi, chatId);

    return {
      ok: true,
      chatId,
      creatorInviteLink,
      counterpartInviteLink,
      inviteLink: creatorInviteLink,
      creatorInvited,
      ownership: "helper",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("createEscrowGroup failed:", message);
    return { ok: false, reason: "create_failed", error: message };
  }
}

async function exportPartyInviteLink(
  botApi: GrammyApi,
  client: Awaited<ReturnType<typeof getMtprotoHelper>>,
  channel: Api.Channel,
  chatId: number,
  name: string,
): Promise<string | undefined> {
  try {
    const link = await botApi.createChatInviteLink(chatId, {
      name: name.slice(0, 32),
      member_limit: 1,
    });
    return link.invite_link;
  } catch (err) {
    console.warn("bot createChatInviteLink failed, trying MTProto export:", err);
    try {
      const exported = await client.invoke(
        new Api.messages.ExportChatInvite({
          peer: channel,
          requestNeeded: false,
          usageLimit: 1,
        }),
      );
      if (exported instanceof Api.ChatInviteExported) {
        return exported.link;
      }
    } catch (err2) {
      console.warn("MTProto ExportChatInvite failed:", err2);
    }
  }
  return undefined;
}

/** Applica (di nuovo) i permessi anti-danni via Bot API. */
export async function hardenGroupPermissions(
  botApi: GrammyApi,
  chatId: number,
): Promise<void> {
  try {
    await botApi.setChatPermissions(chatId, BOT_API_MEMBER_PERMISSIONS);
  } catch (err) {
    console.warn(`hardenGroupPermissions ${chatId}:`, err);
  }
}

/**
 * Demote human administrators (not the Telegram creator/owner).
 * On helper-created groups the owner is the helper — parties become editable admins
 * only if someone promotes them; bot can strip those rights.
 */
export async function demoteNonOwnerHumanAdmins(
  botApi: GrammyApi,
  chatId: number,
): Promise<number> {
  let demoted = 0;
  let meId: number;
  try {
    meId = (await botApi.getMe()).id;
  } catch {
    return 0;
  }

  let admins: Awaited<ReturnType<GrammyApi["getChatAdministrators"]>>;
  try {
    admins = await botApi.getChatAdministrators(chatId);
  } catch (err) {
    console.warn(`demoteNonOwnerHumanAdmins getChatAdministrators ${chatId}:`, err);
    return 0;
  }

  for (const admin of admins) {
    if (admin.status === "creator") continue;
    if (admin.user.is_bot && admin.user.id === meId) continue;
    if (admin.user.is_bot) {
      // Extra bots: prefer kick elsewhere; skip demote.
      continue;
    }
    if (admin.status !== "administrator") continue;
    if (!admin.can_be_edited) continue;

    try {
      await botApi.promoteChatMember(chatId, admin.user.id, { ...DEMOTE_RIGHTS });
      demoted += 1;
    } catch (err) {
      console.warn(`demote admin ${admin.user.id} in ${chatId}:`, err);
    }
  }
  return demoted;
}

/**
 * If a deal party (or any human) just became administrator on a helper-owned
 * group, strip admin rights when the bot can edit them.
 */
export async function demoteIfPartyPromoted(
  botApi: GrammyApi,
  chatId: number,
  userId: number,
  opts?: { isBot?: boolean; skipUserIds?: number[] },
): Promise<boolean> {
  if (opts?.isBot) return false;
  if (opts?.skipUserIds?.includes(userId)) return false;

  try {
    const member = await botApi.getChatMember(chatId, userId);
    if (member.status === "creator") return false;
    if (member.status !== "administrator") return false;
    if (!member.can_be_edited) return false;
    await botApi.promoteChatMember(chatId, userId, { ...DEMOTE_RIGHTS });
    return true;
  } catch (err) {
    console.warn(`demoteIfPartyPromoted ${userId} in ${chatId}:`, err);
    return false;
  }
}
