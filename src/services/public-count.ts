import type { Api } from "grammy";
import { config } from "../config.js";

/** Formato italiano: «4.501 iscritti». */
export function formatIscrittiLabel(count: number): string {
  const n = Math.max(0, Math.floor(count));
  return `${n.toLocaleString("it-IT")} iscritti`;
}

function buildDescription(count: number): string {
  const label = formatIscrittiLabel(count);
  return `${label} · Escrowita — escrow crypto Italia.`;
}

function buildPinnedText(count: number): string {
  const label = formatIscrittiLabel(count);
  return `*Escrowita*\n${label}`;
}

/**
 * Aggiorna il conteggio pubblico sul canale aggiornamenti.
 * - Se `UPDATES_CHANNEL_MESSAGE_ID`: edit del messaggio vivente (idealmente fissato).
 * - Altrimenti: `setChatDescription` con «N iscritti».
 * Best-effort: errori loggati, non bloccano l'iscrizione.
 */
export async function publishIscrittiCount(
  api: Api,
  count: number,
): Promise<void> {
  const channelId = config.updatesChannelId;
  if (channelId == null) return;

  const messageId = config.updatesChannelMessageId;

  try {
    if (messageId != null) {
      await api.editMessageText(channelId, messageId, buildPinnedText(count), {
        parse_mode: "Markdown",
      });
      return;
    }
    await api.setChatDescription(channelId, buildDescription(count));
  } catch (err) {
    console.warn(
      `publishIscrittiCount channel=${channelId} count=${count}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
