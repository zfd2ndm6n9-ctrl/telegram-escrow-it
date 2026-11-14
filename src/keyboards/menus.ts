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

export function createGroupKeyboard(startGroupUrl: string): InlineKeyboard {
  return new InlineKeyboard().url("👥 Crea gruppo escrow", startGroupUrl);
}

export function groupActionsKeyboard(status: string): InlineKeyboard {
  const kb = new InlineKeyboard().text("📫 Indirizzo escrow", "addr").row();

  if (status === "awaiting_deposit") {
    kb.text("💰 Segna depositato", "funded").row();
  }

  if (status === "funded" || status === "release_pending" || status === "refund_pending" || status === "disputed") {
    kb.text("🔓 pay_seller", "pay_seller").text("↩️ refund_buyer", "refund_buyer").row();
  }

  kb.text("⚠️ Disputa", "dispute").text("📄 Stato", "stato");
  return kb;
}
