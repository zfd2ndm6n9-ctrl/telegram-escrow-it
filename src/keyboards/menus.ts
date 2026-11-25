import { InlineKeyboard, Keyboard } from "grammy";
import type { Deal } from "../types.js";

export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("➕ Crea escrow")
    .text("📋 I miei deal")
    .resized()
    .persistent();
}

/** Invito opzionale su /crea: niente `/skip` tappable nel testo. */
export function inviteSkipKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Nessun codice", "invite_skip");
}

/** Redirect gruppo → DM bot (deep-link opzionale `?start=crea`). */
export function openBotDmKeyboard(botUrl: string): InlineKeyboard {
  return new InlineKeyboard().url("Apri il bot", botUrl);
}

/** @deprecated Prefer inline `crea_cancel` on role/asset prompts. */
export function cancelKeyboard(): Keyboard {
  return new Keyboard().text("❌ Annulla").resized().oneTime();
}

/**
 * /crea ruolo: inline so buttons stay when the phone keyboard opens.
 * Callbacks: `crea_role:buyer` | `crea_role:seller` | `crea_cancel`.
 */
export function roleKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🛒 Sono il buyer", "crea_role:buyer")
    .text("🏪 Sono il seller", "crea_role:seller")
    .row()
    .text("❌ Annulla", "crea_cancel");
}

/**
 * Crypto step: SOL live; ETH/LTC shown for UX, labeled coming soon.
 * Inline so free text / phone keyboard does not hide choices.
 * Callbacks: `crea_asset:SOL` | `crea_asset:ETH` | `crea_asset:LTC` | `crea_cancel`.
 */
export function assetKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("◎ SOL", "crea_asset:SOL")
    .text("ETH (presto)", "crea_asset:ETH")
    .text("LTC (presto)", "crea_asset:LTC")
    .row()
    .text("❌ Annulla", "crea_cancel");
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

/** DM con link invito gruppo (creator e/o controparte). */
export function groupInviteKeyboard(
  inviteLink: string,
  tosWebAppUrl?: string,
  opts?: { counterpartLink?: string },
): InlineKeyboard {
  const kb = new InlineKeyboard().url("🔗 Entra nel gruppo", inviteLink).row();
  if (opts?.counterpartLink && opts.counterpartLink !== inviteLink) {
    kb.url("🔗 Link per l'altra parte", opts.counterpartLink).row();
  }
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

/**
 * Conferma same-@ azioni sensibili: Sì + ← Indietro (niente «No»).
 * Callback: `sc_yes` / `sc_back` (kind sul deal.pendingSelfConfirm).
 */
export function selfConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Sì", "sc_yes").text("← Indietro", "sc_back");
}

/**
 * Schermate aperte da click (Stato / Altre info / hash / …):
 * ← Indietro chiude l'effimero; i CTA di stage restano.
 */
export function uiBackKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("← Indietro", "ui_back");
}

/**
 * Fallback disputa se DM admin fallisce: invite gruppo + deep-link bot (`/start deal_ID`).
 */
export function disputeAdminFallbackKeyboard(opts: {
  inviteLink?: string;
  startLink: string;
}): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (opts.inviteLink) {
    kb.url("Entra nel gruppo", opts.inviteLink).row();
  }
  kb.url("Apri bot + deal", opts.startLink);
  return kb;
}

/**
 * Sotto Altre info: solo Indietro (Disputa è sulla tastiera principale).
 */
export function altreInfoKeyboard(): InlineKeyboard {
  return uiBackKeyboard();
}

/**
 * Post-deposito pre-consegna: Consegnato (seller) + Disputa + Altre info.
 * Rimborso non in UI qui — via percorso Disputa.
 */
export function shipAskKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Consegnato", "shipped")
    .row()
    .text("⚠️ Disputa", "dispute")
    .text("ℹ️ Altre info", "altre_info");
}

/**
 * Dopo consegna: CTA buyer (paga / rimborso) + disputa / altre info.
 * «Paga» / «Chiedi il rimborso» buyer-only (gate handler); seller usa Disputa / Altre info.
 * Altre info = stato + fee (callback `altre_info`, non più ask-seller).
 */
export function buyerAfterShipKeyboard(_deal: Deal): InlineKeyboard {
  void _deal;
  return new InlineKeyboard()
    .text("🔓 Paga", "buyer_pay")
    .row()
    .text("↩️ Chiedi il rimborso", "refund_buyer")
    .row()
    .text("⚠️ Disputa", "dispute")
    .text("ℹ️ Altre info", "altre_info");
}

/** Dual-confirm 1/2: Confermo (2/2) + Annulla (abort → deal funded). */
export function sellerConfirmPayKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confermo", "seller_confirm_pay")
    .text("Annulla", "cancel_confirm_pay");
}

/** Dual-confirm refund 1/2: Confermo (2/2) + Annulla (abort → deal funded). */
export function refundConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confermo", "confirm_refund")
    .text("Annulla", "cancel_confirm_refund");
}

/** Sotto il messaggio di rilascio: mostra solo la signature. */
export function payoutHashKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Hash", "show_hash");
}

/**
 * Tastiera azioni gruppo.
 * Niente «Paga seller» / pay_seller in UI: rilascio via flusso consegna→buyer.
 * Niente «Indirizzo escrow» / «Verifica deposito» standalone: deposito in Stato.
 * Pre-deposito: Altre info + Stato — niente Disputa finché il deposito non è confermato.
 * Post-deposito pre-consegna: Consegnato + Disputa + Altre info (rimborso via Disputa).
 * Dopo consegna / refund_pending: Chiedi il rimborso (buyer-gated) resta disponibile.
 * Post-deposito: Stato assorbito in Altre info (niente bottone Stato duplicato).
 * Annulla disputa solo opener (gate nel handler).
 */
export function groupActionsKeyboard(status: string, deal?: Deal): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (status === "disputed") {
    // Altre info → solo «IN DISPUTA» (niente deposito/importo/prezzo).
    kb.text("ℹ️ Altre info", "altre_info").row();
    kb.text("↩️ Annulla disputa", "dispute_cancel");
    return kb;
  }

  const postDeposit =
    status === "funded" ||
    status === "refund_pending" ||
    status === "release_pending" ||
    status === "released" ||
    status === "refunded";

  // Post-deposito pre-consegna: solo Consegnato (niente rimborso su questa CTA).
  if (status === "funded" && deal && !deal.sellerShippedAt) {
    kb.text("✅ Consegnato", "shipped").row();
  } else if (status === "funded" || status === "refund_pending") {
    // Dopo consegna (o refund già avviato): rimborso buyer-gated.
    kb.text("↩️ Chiedi il rimborso", "refund_buyer").row();
  }

  if (postDeposit) {
    kb.text("⚠️ Disputa", "dispute").text("ℹ️ Altre info", "altre_info").row();
  } else {
    // Pre-deposito: niente Disputa; Stato verifica il deposito.
    kb.text("ℹ️ Altre info", "altre_info").row();
    kb.text("📄 Stato", "stato");
  }
  return kb;
}
