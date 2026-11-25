import type { Api } from "grammy";
import { config } from "../config.js";

/**
 * Menu button del bot → Mini App ToS (DM default + canale vouch se possibile).
 * Soft-fail: canali a volte non accettano menu_button web_app.
 */
export async function ensureTosMenuButtons(api: Api): Promise<void> {
  const tosUrl = config.tosWebAppUrl;
  if (!tosUrl) {
    console.warn(
      "[tos-menu] skip: manca PUBLIC_BASE_URL / RENDER_EXTERNAL_URL / TOS_URL",
    );
    return;
  }

  const menu = {
    type: "web_app" as const,
    text: "📄 Termini",
    web_app: { url: tosUrl },
  };

  try {
    await api.setChatMenuButton({ menu_button: menu });
    console.log(`[tos-menu] default menu_button → ${tosUrl}`);
  } catch (err) {
    console.warn(
      "[tos-menu] setChatMenuButton default fallito:",
      err instanceof Error ? err.message : err,
    );
  }

  const channelId = config.vouchChannelId;
  if (channelId == null) return;

  // setChatMenuButton chat_id è pensato per chat private (number).
  // Sul canale: tentativo best-effort solo con id numerico; altrimenti pin.
  if (typeof channelId !== "number") {
    console.warn(
      `[tos-menu] vouch channel menu_button skip (serve id numerico, got ${channelId})`,
    );
    return;
  }

  try {
    await api.setChatMenuButton({
      chat_id: channelId,
      menu_button: menu,
    });
    console.log(
      `[tos-menu] vouch channel menu_button ok (${channelId}) → ${tosUrl}`,
    );
  } catch (err) {
    // Tipico sui canali: niente menu bot. Il pin + bottone restano il path.
    console.warn(
      `[tos-menu] vouch channel menu_button skip (${channelId}):`,
      err instanceof Error ? err.message : err,
    );
  }
}
