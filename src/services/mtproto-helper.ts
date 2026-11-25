import { Api, TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { config } from "../config.js";

let clientPromise: Promise<TelegramClient> | null = null;

export function isMtprotoHelperConfigured(): boolean {
  return Boolean(
    config.telegramApiId &&
      config.telegramApiHash &&
      config.telegramHelperSession,
  );
}

/**
 * Client MTProto dell'account helper (owner dei gruppi escrow).
 * Serve perché la Bot API non può creare gruppi.
 */
export async function getMtprotoHelper(): Promise<TelegramClient> {
  if (!isMtprotoHelperConfigured()) {
    throw new Error(
      "Helper MTProto non configurato: imposta TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_HELPER_SESSION",
    );
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new TelegramClient(
        new StringSession(config.telegramHelperSession!),
        config.telegramApiId!,
        config.telegramApiHash!,
        {
          connectionRetries: 5,
        },
      );
      await client.connect();
      if (!(await client.checkAuthorization())) {
        await client.disconnect();
        clientPromise = null;
        throw new Error(
          "TELEGRAM_HELPER_SESSION non autorizzata. Rigenera con: npm run helper:login",
        );
      }
      console.log("Helper MTProto connesso (creazione gruppi escrow).");
      return client;
    })().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }

  return clientPromise;
}

export async function stopMtprotoHelper(): Promise<void> {
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.disconnect();
  } catch (err) {
    console.warn("stopMtprotoHelper:", err);
  } finally {
    clientPromise = null;
  }
}

export function extractCreatedChannel(
  updates: Api.TypeUpdates,
): Api.Channel | undefined {
  const chats =
    updates instanceof Api.Updates || updates instanceof Api.UpdatesCombined
      ? updates.chats
      : updates instanceof Api.UpdateShort
        ? []
        : "chats" in updates && Array.isArray((updates as { chats?: unknown }).chats)
          ? ((updates as { chats: Api.TypeChat[] }).chats ?? [])
          : [];

  for (const chat of chats) {
    if (chat instanceof Api.Channel && Boolean(chat.megagroup)) {
      return chat;
    }
  }
  for (const chat of chats) {
    if (chat instanceof Api.Channel) return chat;
  }
  return undefined;
}

/** Chat id Bot API per un canale/supergroup (`-100` + channel id). */
export function channelToBotApiChatId(channel: Api.Channel): number {
  return Number(`-100${channel.id.toString()}`);
}

/**
 * Sposta un peer nella cartella Archiviati dell'account helper (folder_id = 1).
 * Così i gruppi escrow non allagano la inbox principale del supporto.
 * Soft-fail: la create resta ok anche se l'archive fallisce.
 *
 * Accetta `Api.Channel` (teleproto risolve a InputPeer) o un InputPeer già pronto.
 */
export async function archiveHelperPeer(
  peer: Api.Channel | Api.TypeInputPeer,
): Promise<boolean> {
  const client = await getMtprotoHelper();
  try {
    await client.invoke(
      new Api.folders.EditPeerFolders({
        folderPeers: [
          new Api.InputFolderPeer({
            // Channel funziona come peer (stesso pattern di EditChatDefaultBannedRights).
            peer: peer as Api.TypeInputPeer,
            folderId: 1, // Telegram "Archived chats"
          }),
        ],
      }),
    );
    return true;
  } catch (err) {
    console.warn("archiveHelperPeer (folders.EditPeerFolders) failed:", err);
    return false;
  }
}
