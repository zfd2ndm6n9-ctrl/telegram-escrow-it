import { InlineKeyboard, Keyboard } from "grammy";

export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("➕ Crea escrow")
    .text("📋 I miei deal")
    .row()
    .text("❓ Aiuto")
    .resized()
    .persistent();
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

/** Post-crea: startgroup + ToS piattaforma. Label senza «amministratore» / `+`. */
export function afterAmountKeyboard(
  startGroupUrl: string,
  tosUrl?: string,
): InlineKeyboard {
  const kb = new InlineKeyboard()
    .url("Aggiungi il bot al gruppo", startGroupUrl)
    .row();
  if (tosUrl) {
    kb.url("📄 Leggi i Termini", tosUrl);
  } else {
    kb.text("📄 Leggi i Termini", "tos");
  }
  return kb;
}

/** DM con link invito gruppo. */
export function groupInviteKeyboard(inviteLink: string, tosUrl?: string): InlineKeyboard {
  const kb = new InlineKeyboard().url("🔗 Apri il gruppo", inviteLink).row();
  if (tosUrl) {
    kb.url("📄 Leggi i Termini", tosUrl);
  } else {
    kb.text("📄 Leggi i Termini", "tos");
  }
  return kb;
}

export function counterpartConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo", `cp:${dealId}`);
}

export function tosConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Accetto i ToS", `tosok:${dealId}`);
}

export function amountConfirmKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ Confermo importo", `amtok:${dealId}`);
}

export function groupActionsKeyboard(status: string): InlineKeyboard {
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

  if (
    status === "funded" ||
    status === "release_pending" ||
    status === "refund_pending" ||
    status === "disputed"
  ) {
    kb.text("🔓 Paga seller", "pay_seller")
      .text("↩️ Rimborsa buyer", "refund_buyer")
      .row();
  }

  kb.text("⚠️ Disputa", "dispute").text("📄 Stato", "stato");
  return kb;
}
