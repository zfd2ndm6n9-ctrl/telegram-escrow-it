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

/** Diritti admin più forti utili al bot escrow (no ownership transfer). */
export const BOT_ADMIN_RIGHTS = new Api.ChatAdminRights({
  changeInfo: true,
  postMessages: true,
  editMessages: true,
  deleteMessages: true,
  banUsers: true,
  inviteUsers: true,
  pinMessages: true,
  addAdmins: false,
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

export type CreateEscrowGroupResult =
  | {
      ok: true;
      chatId: number;
      inviteLink: string;
      creatorInvited: boolean;
    }
  | { ok: false; error: string };

export function groupCreatorReady(): boolean {
  return isMtprotoHelperConfigured() && Boolean(config.botUsername);
}

/**
 * Crea un supergroup privato per il deal:
 * helper = owner (non le parti) → bot admin con diritti forti →
 * permessi membri ristretti → invita creator se possibile → link invito.
 */
export async function createEscrowGroup(input: {
  deal: Deal;
  botApi: GrammyApi;
  creatorId: number;
  creatorUsername?: string;
}): Promise<CreateEscrowGroupResult> {
  if (!isMtprotoHelperConfigured()) {
    return {
      ok: false,
      error:
        "Creazione gruppo non configurata (manca helper MTProto). Avvisa l'admin.",
    };
  }

  const botUsername = config.botUsername;
  if (!botUsername) {
    return { ok: false, error: "Username bot sconosciuto." };
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
      return { ok: false, error: "Gruppo creato ma id chat non trovato." };
    }

    const chatId = channelToBotApiChatId(channel);

    // Aggiunge il bot come admin (in megagroup i bot entrano solo come admin).
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

    // Specchio permessi via Bot API (idempotente).
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

    let inviteLink: string | undefined;
    try {
      const link = await input.botApi.createChatInviteLink(chatId, {
        name: `deal-${input.deal.id}`.slice(0, 32),
        member_limit: 2,
      });
      inviteLink = link.invite_link;
    } catch (err) {
      console.warn("bot createChatInviteLink failed, trying MTProto export:", err);
      try {
        const exported = await client.invoke(
          new Api.messages.ExportChatInvite({
            peer: channel,
            requestNeeded: false,
          }),
        );
        if (exported instanceof Api.ChatInviteExported) {
          inviteLink = exported.link;
        }
      } catch (err2) {
        console.warn("MTProto ExportChatInvite failed:", err2);
      }
    }

    if (!inviteLink) {
      return {
        ok: false,
        error: "Gruppo creato ma impossibile generare il link invito.",
      };
    }

    // Titolo già impostato in create; ritenta via bot per coerenza.
    try {
      await input.botApi.setChatTitle(chatId, title);
    } catch {
      // ok
    }

    return { ok: true, chatId, inviteLink, creatorInvited };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("createEscrowGroup failed:", message);
    return { ok: false, error: message };
  }
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
