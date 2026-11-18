import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../config.js";

export type VouchMembership =
  | { ok: true; member: true }
  | { ok: true; member: false }
  | { ok: false; reason: "no_channel" | "api_error"; detail?: string };

const MEMBER_STATUSES = new Set([
  "creator",
  "administrator",
  "member",
  "restricted",
]);

/**
 * Verifica se l'utente è nel canale vouch (`VOUCH_CHANNEL_ID`).
 * Richiede bot admin sul canale (almeno lettura membri).
 */
export async function checkVouchMembership(
  api: Api,
  userId: number,
): Promise<VouchMembership> {
  const channelId = config.vouchChannelId;
  if (channelId == null) {
    return { ok: false, reason: "no_channel" };
  }

  try {
    const member = await api.getChatMember(channelId, userId);
    const inChannel = MEMBER_STATUSES.has(member.status);
    return { ok: true, member: inChannel };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(
      `[vouch] getChatMember channel=${channelId} user=${userId} failed: ${detail}`,
    );
    return { ok: false, reason: "api_error", detail };
  }
}

export function vouchInviteLink(): string {
  return config.vouchInviteLink;
}

/** Bottone URL verso il canale reviews/vouch. */
export function vouchJoinKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url("Entra nel canale", vouchInviteLink())
    .row()
    .text("Sono entrato", "vouch_joined");
}
