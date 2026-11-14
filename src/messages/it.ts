import type { Deal } from "../types.js";

export const it = {
  welcome: `Ciao! Sono il bot di *escrow crypto* per deal tra privati.

Funziono solo in chat privata con me (niente gruppi).
Tu e la controparte vi conoscete già: io custodisco i fondi fino a release o rimborso.

Comandi:
/crea — crea un nuovo deal
/deal \\<id\\> — dettaglio deal
/miei — i tuoi deal
/dispute \\<id\\> — apri una disputa
/aiuto — guida rapida`,

  help: `*Guida rapida*

1. /crea — inserisci importo (USDT) e controparte (@username o id)
2. La controparte conferma il deal (pulsante o /start deal\\_ID)
3. Il bot mostra l'indirizzo escrow (mock in MVP)
4. Dopo il deposito (segnalato manualmente in MVP), release o rimborso con *doppia conferma*
5. /dispute \\<id\\> avvisa l'admin se configurato

Asset MVP: solo USDT (placeholder). Wallet reale in arrivo.`,

  askAmount: "Quanto vuoi mettere in escrow? Invia l'importo in USDT (es. `100` o `50.5`).",
  askCounterpart:
    "Indica la controparte: @username oppure id Telegram numerico.\nEsempio: `@mario` oppure `123456789`",
  invalidAmount: "Importo non valido. Invia un numero positivo (es. `100` o `12.5`).",
  invalidCounterpart:
    "Controparte non valida. Usa @username (min 5 caratteri) o un id numerico.",
  cancelled: "Operazione annullata.",
  unknownCommand: "Non ho capito. Usa /aiuto oppure i pulsanti del menu.",

  dealCreated: (deal: Deal, botUsername?: string) => {
    const link = botUsername
      ? `https://t.me/${botUsername}?start=deal_${deal.id}`
      : `(apri il bot con /start deal_${deal.id})`;
    const cp =
      deal.counterpartUsername != null
        ? `@${deal.counterpartUsername}`
        : deal.counterpartId != null
          ? String(deal.counterpartId)
          : "?";
    return `✅ Deal *#${deal.id}* creato (in attesa di conferma).

• Importo: *${deal.amount} ${deal.asset}*
• Controparte: ${cp}
• Stato: in attesa conferma

Invita la controparte con questo link:
${link}`;
  },

  dealSummary: (deal: Deal) => {
    const cp =
      deal.counterpartUsername != null
        ? `@${deal.counterpartUsername}`
        : deal.counterpartId != null
          ? String(deal.counterpartId)
          : "non collegata";
    const creator =
      deal.creatorUsername != null ? `@${deal.creatorUsername}` : String(deal.creatorId);
    return `*Deal #${deal.id}*
• Creatore: ${creator}
• Controparte: ${cp}
• Importo: *${deal.amount} ${deal.asset}*
• Stato: \`${deal.status}\`
• Escrow: \`${deal.escrowAddress}\``;
  },

  confirmPrompt: (deal: Deal) =>
    `Ti è stato proposto un deal escrow:

• ID: *#${deal.id}*
• Importo: *${deal.amount} ${deal.asset}*
• Creatore: ${deal.creatorUsername ? `@${deal.creatorUsername}` : deal.creatorId}

Confermi di partecipare?`,

  confirmed: (deal: Deal) =>
    `🤝 Deal *#${deal.id}* confermato da entrambe le parti.

Invia *${deal.amount} ${deal.asset}* a questo indirizzo escrow (mock MVP):
\`${deal.escrowAddress}\`

⚠️ In produzione verifica sempre l'indirizzo dal bot ufficiale. Wallet reale non ancora collegato.`,

  alreadyConfirmed: "Questo deal è già stato confermato o non è più in attesa.",
  notCounterpart: "Solo la controparte indicata può confermare questo deal.",
  notParty: "Non fai parte di questo deal.",
  dealNotFound: "Deal non trovato. Controlla l'id (es. /deal ab12cd34).",
  noDeals: "Non hai ancora deal. Usa /crea per iniziarne uno.",

  markFundedDone: (deal: Deal) =>
    `💰 Deal *#${deal.id}* segnato come *fondato* (stub MVP — nessuna verifica on-chain).

Ora puoi chiedere *rilascio* o *rimborso* (serve conferma di entrambe le parti).`,

  releaseVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto release registrato per #${deal.id}. Manca ancora ${remaining} conferma.`
      : `🔓 Deal *#${deal.id}* *rilasciato* (stub — nessun transfer reale).`,

  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto rimborso registrato per #${deal.id}. Manca ancora ${remaining} conferma.`
      : `↩️ Deal *#${deal.id}* *rimborsato* (stub — nessun transfer reale).`,

  wrongStatus: (status: string) =>
    `Azione non disponibile nello stato attuale (\`${status}\`).`,

  disputeOpened: (deal: Deal) =>
    `⚠️ Disputa aperta sul deal *#${deal.id}*. Un admin è stato avvisato (se configurato).`,

  disputeAdminNotify: (deal: Deal, fromId: number, fromUsername?: string) =>
    `🚨 /dispute su deal #${deal.id}
Da: ${fromUsername ? `@${fromUsername}` : fromId} (${fromId})
Importo: ${deal.amount} ${deal.asset}
Stato: ${deal.status}
Creator: ${deal.creatorId} / Counterpart: ${deal.counterpartId ?? deal.counterpartUsername ?? "?"}`,

  adminMissing:
    "Disputa registrata, ma ADMIN_TELEGRAM_ID non è configurato: nessun admin notificato.",

  needDealId: "Specifica l'id del deal. Esempio: /dispute ab12cd34",
} as const;

export function statusLabel(status: Deal["status"]): string {
  const map: Record<Deal["status"], string> = {
    pending_confirm: "in attesa conferma",
    awaiting_deposit: "in attesa deposito",
    funded: "fondato",
    release_pending: "release in corso",
    refund_pending: "rimborso in corso",
    released: "rilasciato",
    refunded: "rimborsato",
    disputed: "in disputa",
    cancelled: "annullato",
  };
  return map[status];
}
