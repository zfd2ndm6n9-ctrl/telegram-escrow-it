import { Api, TelegramClient } from "teleproto";
import { returnBigInt } from "teleproto/Helpers";
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

/** Bot API `-100…` → channel id MTProto. */
export function botApiChatIdToChannelId(chatId: number): ReturnType<typeof returnBigInt> {
  const s = String(chatId);
  if (s.startsWith("-100")) {
    return returnBigInt(s.slice(4));
  }
  throw new Error(`chatId ${chatId} non è un megagroup/channel Bot API (-100…)`);
}

function errDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; errorMessage?: unknown };
    if (typeof e.errorMessage === "string" && e.errorMessage.trim()) {
      return e.errorMessage;
    }
    if (typeof e.message === "string" && e.message.trim()) {
      return e.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Risolve un megagroup helper da Bot API chat id (cache → dialoghi Archiviati).
 * Soft: undefined se non trovato (sessione senza entity / gruppo già eliminato).
 */
export async function resolveHelperChannel(
  chatId: number,
  accessHash?: string,
): Promise<Api.Channel | Api.InputChannel | undefined> {
  if (accessHash != null && accessHash.trim() !== "") {
    try {
      return new Api.InputChannel({
        channelId: botApiChatIdToChannelId(chatId),
        accessHash: returnBigInt(accessHash),
      });
    } catch (err) {
      console.warn(
        `[mtproto] InputChannel from accessHash failed chat=${chatId}: ${errDetail(err)}`,
      );
    }
  }

  if (!isMtprotoHelperConfigured()) return undefined;
  const client = await getMtprotoHelper();

  const tryGet = async (): Promise<Api.Channel | undefined> => {
    try {
      const entity = await client.getEntity(chatId);
      if (entity instanceof Api.Channel) return entity;
    } catch {
      // not in cache
    }
    return undefined;
  };

  let channel = await tryGet();
  if (channel) return channel;

  // Dopo restart StringSession non ha entity cache: ripopola da Archiviati (+ inbox).
  try {
    for await (const _ of client.iterDialogs({ archived: true })) {
      // populate cache only
    }
    for await (const _ of client.iterDialogs({ archived: false })) {
      // populate cache only
    }
  } catch (err) {
    console.warn(
      `[mtproto] iterDialogs refresh failed chat=${chatId}: ${errDetail(err)}`,
    );
  }

  channel = await tryGet();
  return channel;
}

/**
 * Elimina un megagroup di cui l'helper è owner (`channels.DeleteChannel`).
 * Soft-fail: mai throw; log chiaro su successo/fallimento.
 */
export async function deleteHelperOwnedGroup(
  chatId: number,
  accessHash?: string,
): Promise<boolean> {
  if (!isMtprotoHelperConfigured()) {
    console.warn(
      `[group-cleanup] MTProto delete skip chat=${chatId}: helper non configurato`,
    );
    return false;
  }

  try {
    const client = await getMtprotoHelper();
    const channel = await resolveHelperChannel(chatId, accessHash);
    if (!channel) {
      console.warn(
        `[group-cleanup] MTProto delete skip chat=${chatId}: channel non risolto (cache/dialoghi)`,
      );
      return false;
    }

    await client.invoke(new Api.channels.DeleteChannel({ channel }));
    console.log(`[group-cleanup] MTProto DeleteChannel ok chat=${chatId}`);
    return true;
  } catch (err) {
    console.warn(
      `[group-cleanup] MTProto DeleteChannel failed chat=${chatId}: ${errDetail(err)}`,
    );
    return false;
  }
}
