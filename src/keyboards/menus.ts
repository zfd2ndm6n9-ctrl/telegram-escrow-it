import { InlineKeyboard, Keyboard } from "grammy";

export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("➕ Crea deal")
    .text("📋 I miei deal")
    .row()
    .text("❓ Aiuto")
    .resized()
    .persistent();
}

export function cancelKeyboard(): Keyboard {
  return new Keyboard().text("❌ Annulla").resized().oneTime();
}

export function confirmDealKeyboard(dealId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Conferma deal", `confirm:${dealId}`)
    .text("❌ Rifiuta", `reject:${dealId}`);
}

export function dealActionsKeyboard(dealId: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard();

  if (status === "awaiting_deposit") {
    kb.text("💰 Segna depositato (stub)", `funded:${dealId}`).row();
  }

  if (status === "funded" || status === "release_pending" || status === "refund_pending") {
    kb.text("🔓 Rilascia", `release:${dealId}`)
      .text("↩️ Rimborsa", `refund:${dealId}`)
      .row();
  }

  kb.text("⚠️ Disputa", `dispute:${dealId}`).text("📄 Dettaglio", `detail:${dealId}`);
  return kb;
}
