import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Api } from "grammy";
import { config } from "../config.js";
import {
  vouchTosKeyboard,
  vouchTosUrlKeyboard,
} from "../keyboards/menus.js";

/** Teaser corto sul canale vouch (apre Mini App ToS). */
export const VOUCH_TOS_TEASER =
  "📄 *ESCROWITA TOS* — termini di servizio della piattaforma.\nTocca il bottone per aprirli.";

type PinState = {
  channelId: string;
  messageId: number;
  updatedAt: string;
};

function pinStatePath(): string {
  return join(config.dataDir, "vouch-tos-pin.json");
}

function channelKey(id: string | number): string {
  return String(id);
}

function loadPinState(): PinState | undefined {
  const path = pinStatePath();
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as PinState;
    if (
      raw &&
      typeof raw.channelId === "string" &&
      typeof raw.messageId === "number"
    ) {
      return raw;
    }
  } catch (err) {
    console.warn("[vouch-tos] lettura pin state fallita:", err);
  }
  return undefined;
}

function savePinState(state: PinState): void {
  const path = pinStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function errDetail(err: unknown): string {
  if (err && typeof err === "object" && "description" in err) {
    return String((err as { description?: string }).description ?? err);
  }
  return err instanceof Error ? err.message : String(err);
}

export type VouchTosPinResult =
  | { ok: true; messageId: number; reused: boolean; via: "web_app" | "url" }
  | {
      ok: false;
      reason: "no_channel" | "no_tos_url" | "post_failed" | "pin_failed";
      detail?: string;
    };

/**
 * Pubblica (o riusa) il messaggio fisso ToS sul canale vouch e lo pinna.
 * Soft-fail su permessi post/pin. `force` ripubblica anche se già tracciato.
 */
export async function ensureVouchTosPin(
  api: Api,
  opts?: { force?: boolean },
): Promise<VouchTosPinResult> {
  const channelId = config.vouchChannelId;
  if (channelId == null) {
    return { ok: false, reason: "no_channel" };
  }
  const tosUrl = config.tosWebAppUrl;
  if (!tosUrl) {
    return { ok: false, reason: "no_tos_url" };
  }

  const force = opts?.force === true;
  const prev = loadPinState();
  const sameChannel =
    prev != null && prev.channelId === channelKey(channelId);

  if (sameChannel && !force) {
    try {
      await api.pinChatMessage(channelId, prev!.messageId, {
        disable_notification: true,
      });
    } catch (err) {
      // Già pinnato o permessi pin assenti: ok se il messaggio esiste
      console.warn(
        `[vouch-tos] pin esistente msg=${prev!.messageId}: ${errDetail(err)}`,
      );
    }
    return {
      ok: true,
      messageId: prev!.messageId,
      reused: true,
      via: "web_app",
    };
  }

  // /pin_tos (force): prova a aggiornare il messaggio già tracciato.
  if (sameChannel && force && prev) {
    for (const via of ["web_app", "url"] as const) {
      try {
        await api.editMessageText(channelId, prev.messageId, VOUCH_TOS_TEASER, {
          parse_mode: "Markdown",
          reply_markup:
            via === "web_app"
              ? vouchTosKeyboard(tosUrl)
              : vouchTosUrlKeyboard(tosUrl),
        });
        try {
          await api.pinChatMessage(channelId, prev.messageId, {
            disable_notification: true,
          });
        } catch (pinErr) {
          console.warn(
            `[vouch-tos] re-pin dopo edit fallito: ${errDetail(pinErr)}`,
          );
        }
        savePinState({
          channelId: channelKey(channelId),
          messageId: prev.messageId,
          updatedAt: new Date().toISOString(),
        });
        return {
          ok: true,
          messageId: prev.messageId,
          reused: true,
          via,
        };
      } catch (editErr) {
        console.warn(
          `[vouch-tos] edit ${via} fallito, provo send: ${errDetail(editErr)}`,
        );
      }
    }
  }

  let messageId: number | undefined;
  let via: "web_app" | "url" = "web_app";

  try {
    const msg = await api.sendMessage(channelId, VOUCH_TOS_TEASER, {
      parse_mode: "Markdown",
      reply_markup: vouchTosKeyboard(tosUrl),
    });
    messageId = msg.message_id;
  } catch (webAppErr) {
    console.warn(
      `[vouch-tos] web_app sul canale fallito, fallback url: ${errDetail(webAppErr)}`,
    );
    try {
      const msg = await api.sendMessage(channelId, VOUCH_TOS_TEASER, {
        parse_mode: "Markdown",
        reply_markup: vouchTosUrlKeyboard(tosUrl),
      });
      messageId = msg.message_id;
      via = "url";
    } catch (urlErr) {
      console.warn(
        `[vouch-tos] post canale fallito (no post perms?): ${errDetail(urlErr)}`,
      );
      return {
        ok: false,
        reason: "post_failed",
        detail: errDetail(urlErr),
      };
    }
  }

  try {
    await api.pinChatMessage(channelId, messageId, {
      disable_notification: true,
    });
  } catch (pinErr) {
    console.warn(
      `[vouch-tos] pin fallito msg=${messageId} (no pin perms?): ${errDetail(pinErr)}`,
    );
    // Messaggio comunque pubblicato: salva id e segnala pin_failed
    savePinState({
      channelId: channelKey(channelId),
      messageId,
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      reason: "pin_failed",
      detail: errDetail(pinErr),
    };
  }

  savePinState({
    channelId: channelKey(channelId),
    messageId,
    updatedAt: new Date().toISOString(),
  });

  return { ok: true, messageId, reused: false, via };
}
