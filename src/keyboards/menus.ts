import { InlineKeyboard, Keyboard } from "grammy";
import type { Deal } from "../types.js";
import { mentionUser } from "../services/deal-logic.js";

export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("➕ Crea escrow")
    .text("📋 I miei deal")
    .resized()
    .persistent();
}

/** Invito opzionale post-/start: niente `/skip` tappable nel testo. */
export function inviteSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Nessun codice", "invite_skip");
}

export function cancelKeyboard(): Keyboard {
  return new Keyboard().text("❌ Annulla").resized().oneTime();
}

export function roleKeyboard(): Keyboard {
  return new Keyboard()
    .text("🛒 Sono il buyer")
    .text("🏪 Sono il seller")
    .row()
    .text("❌ Annulla")
    .resized()
    .oneTime();
}

/** Crypto step: SOL live; ETH/LTC shown for UX, labeled coming soon. */
export function assetKeyboard(): Keyboard {
  return new Keyboard()
    .text("◎ SOL")
    .text("ETH (presto)")
    .text("LTC (presto)")
    .row()
    .text("❌ Annulla")
    .resized()
    .oneTime();
}

/**
 * Post-crea: startgroup + ToS Mini App (`web_app`).
 * Senza URL → callback `tos` (fallback corto in chat).
 */
export function afterAmountKeyboard(
  startGroupUrl: string,
  tosWebAppUrl?: string,
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .url("Aggiungi il bot al gruppo", startGroupUrl)
    .row();
  if (tosWebAppUrl) {
    kb.webApp("📄 Leggi i Termini", tosWebAppUrl);
  } else {
    kb.text("📄 Leggi i Termini", "tos");
  }
  return kb;
}

/** DM con link invito gruppo. */
export function groupInviteKeyboard(
  inviteLink: string,
  tosWebAppUrl?: string,
): InlineKeyboard {
  const kb = new InlineKeyboard().url("🔗 Apri il gruppo", inviteLink).row();
  if (tosWebAppUrl) {
    kb.webApp("📄 Leggi i Termini", tosWebAppUrl);
  } else {
    kb.text("📄 Leggi i Termini", "tos");
  }
  return kb;
}

/** Teaser canale vouch: apre la stessa Mini App ToS. */
export function vouchTosKeyboard(tosWebAppUrl: string): InlineKeyboard {
  return new InlineKeyboard().webApp("📄 Leggi i Termini", tosWebAppUrl);
}

/** Fallback URL se il canale rifiuta `web_app` (Telegram: spesso solo DM). */
export function vouchTosUrlKeyboard(tosWebAppUrl: string): InlineKeyboard {
  return new InlineKeyboard().url("📄 Leggi i Termini", tosWebAppUrl);
}

/** @deprecated Conferma ruolo rimossa: auto-bind su /avvia. */
export function counterpartConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo", `cp:${dealId}`);
}

/**
 * Card termini: controparte può Accetta (lock) o Proponi i ToS (3 Q nel gruppo).
 */
export function tosConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Accetta", `tosok:${dealId}`)
    .text("✏️ Proponi i ToS", `tospropose:${dealId}`);
}

/** @deprecated Dual-confirm importo rimosso; crypto amount dopo Accetto se manca. */
export function amountConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo importo", `amtok:${dealId}`);
}

/** Post-deposito: seller segna consegna; rimborso mutuale sempre raggiungibile. */
export function shipAskKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Consegnato", "shipped")
    .row()
    .text("↩️ Rimborsa buyer", "refund_buyer");
}

/** Dopo consegna: CTA buyer (paga primario / rimborso / info / disputa). */
export function buyerAfterShipKeyboard(deal: Deal): InlineKeyboard {
  const sellerLabel = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
  return new InlineKeyboard()
    .text(`🔓 Paga ${sellerLabel}`, "buyer_pay")
    .row()
    .text("↩️ Rimborsa buyer", "refund_buyer")
    .row()
    .text("ℹ️ Altre info", "buyer_info")
    .text("⚠️ Disputa", "buyer_dispute");
}

/** Dual-confirm: seller conferma il rilascio avviato dal buyer. */
export function sellerConfirmPayKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo", "seller_confirm_pay");
}

/** Dual-confirm refund: la parte in attesa preme Confermo. */
export function refundConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo", "confirm_refund");
}

/** Sotto il messaggio di rilascio: mostra solo la signature. */
export function payoutHashKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Hash", "show_hash");
}

/**
 * Tastiera azioni gruppo.
 * Niente «Paga seller» / pay_seller in UI: rilascio via flusso consegna→buyer.
 * «Rimborsa buyer» post-deposito (dual-confirm); in disputa admin usa comandi silenti.
 */
export function groupActionsKeyboard(status: string, deal?: Deal): InlineKeyboard {
  const kb = new InlineKeyboard();

  const depositReady =
    status === "awaiting_deposit" ||
    status === "funded" ||
    status === "release_pending" ||
    status === "refund_pending" ||
    status === "disputed" ||
    status === "released" ||
    status === "refunded";

  if (depositReady) {
    kb.text("📫 Indirizzo escrow", "addr").row();
  }

  if (status === "awaiting_deposit") {
    kb.text("💰 Verifica deposito", "funded").row();
  }

  // Post-deposito: se non ancora consegnato, bottone consegna (CTA dedicate altrimenti).
  if (status === "funded" && deal && !deal.sellerShippedAt) {
    kb.text("✅ Consegnato", "shipped").row();
  }

  if (status === "disputed") {
    // In disputa: niente label /payseller; admin usa comandi silenti.
    kb.text("📄 Stato", "stato");
    return kb;
  }

  // Mutual refund: solo post-deposito, finché non chiuso / in rilascio.
  if (status === "funded" || status === "refund_pending") {
    kb.text("↩️ Rimborsa buyer", "refund_buyer").row();
  }

  kb.text("⚠️ Disputa", "dispute").text("📄 Stato", "stato");
  return kb;
}
