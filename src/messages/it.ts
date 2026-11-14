import type { Deal } from "../types.js";

export const it = {
  welcome: `Ciao! Sono il bot di *escrow crypto* (Italia).

Per ogni deal creo un *gruppo privato* con solo *2 persone* (buyer + seller) + il bot.
L'admin può entrare solo in caso di disputa.

Comandi (in privato):
/crea — avvia un nuovo escrow
/miei — i tuoi deal
/aiuto — guida`,

  help: `*Guida*

1. In privato: /crea → scegli ruolo (buyer/seller) e importo USDT
2. Apri il link *Crea gruppo escrow* e rendi il bot *amministratore*
3. Condividi il link invito (1 posto) con la controparte
4. Nel gruppo: indirizzo escrow → conferma deposito → /pay_seller o /refund_buyer (doppia conferma)
5. /dispute — avvisa l'admin e gli permette di entrare ad arbitrare

Asset MVP: USDT (placeholder). Wallet reale in arrivo.`,

  askRole: "Che ruolo hai in questo deal?",
  askAmount: "Quanto vuoi mettere in escrow? Importo in USDT (es. `100` o `50.5`).",
  invalidAmount: "Importo non valido. Invia un numero positivo (es. `100` o `12.5`).",
  cancelled: "Operazione annullata.",
  unknownPrivate: "Non ho capito. Usa /aiuto oppure i pulsanti del menu.",

  dealReadyToCreateGroup: (deal: Deal, startGroupUrl: string) =>
    `✅ Deal *#${deal.id}* pronto.

• Ruolo tuo: *${deal.creatorRole}*
• Importo: *${deal.amount} ${deal.asset}*

1. Tocca il pulsante qui sotto per *creare il gruppo* (Telegram include già il bot)
2. Nel gruppo, promuovi il bot ad *amministratore* (almeno: invita utenti + ban)
3. Il bot pubblicherà il link per la controparte (max 1 posto)

${startGroupUrl}`,

  needBotAdmin:
    "⚠️ Sono nel gruppo ma *non sono admin*. Promuovimi ad amministratore (invita utenti + rimuovi membri), poi invia /setup.",

  groupBound: (deal: Deal) =>
    `🔐 Gruppo escrow collegato al deal *#${deal.id}*.

• Importo: *${deal.amount} ${deal.asset}*
• Buyer: ${deal.buyerId != null ? (deal.buyerUsername ? `@${deal.buyerUsername}` : deal.buyerId) : "_in attesa_"}
• Seller: ${deal.sellerId != null ? (deal.sellerUsername ? `@${deal.sellerUsername}` : deal.sellerId) : "_in attesa_"}

Solo *2 persone* + bot. Non aggiungere altri utenti.`,

  inviteCounterpart: (link: string) =>
    `🔗 *Link invito controparte* (1 solo posto):\n${link}\n\nCondividilo in privato con l'altra parte.`,

  counterpartJoined: (deal: Deal) =>
    `🤝 Controparte entrata. Deal *#${deal.id}* pronto per il deposito.

Buyer: invia *${deal.amount} ${deal.asset}* a:
\`${deal.escrowAddress}\`

Poi usa «Segna depositato» o /depositato (stub MVP — nessuna verifica on-chain).`,

  depositAddress: (deal: Deal) =>
    `📫 *Indirizzo escrow* (mock MVP)\n\`${deal.escrowAddress}\`\n\nImporto: *${deal.amount} ${deal.asset}*`,

  markFundedDone: (deal: Deal) =>
    `💰 Deposito segnato sul deal *#${deal.id}* (stub).

Ora: /pay_seller oppure /refund_buyer — serve conferma di *entrambe* le parti.`,

  releaseVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto *pay_seller* registrato (#${deal.id}). Manca ${remaining} conferma.`
      : `🔓 Deal *#${deal.id}* — fondi rilasciati al seller (stub, nessun transfer reale).`,

  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto *refund_buyer* registrato (#${deal.id}). Manca ${remaining} conferma.`
      : `↩️ Deal *#${deal.id}* — rimborso al buyer (stub, nessun transfer reale).`,

  adminForceRelease: (deal: Deal) =>
    `🔓 Admin ha arbitrato: *pay_seller* su #${deal.id} (stub).`,
  adminForceRefund: (deal: Deal) =>
    `↩️ Admin ha arbitrato: *refund_buyer* su #${deal.id} (stub).`,

  wrongStatus: (status: string) =>
    `Azione non disponibile nello stato \`${status}\`.`,

  notParty: "Solo buyer/seller (o admin in disputa) possono farlo.",
  dealNotFound: "Deal non trovato.",
  noDeals: "Nessun deal. Usa /crea in chat privata con il bot.",
  onlyPrivate: "Questo comando va usato in *chat privata* con il bot.",
  onlyGroup: "Questo comando va usato nel *gruppo escrow*.",
  noDealInGroup: "Questo gruppo non è collegato a un deal escrow attivo.",

  kickedExtra: (userId: number) =>
    `🚫 Utente \`${userId}\` rimosso: nel gruppo escrow sono ammessi solo buyer, seller e (in disputa) admin.`,

  disputeOpened: (deal: Deal) =>
    `⚠️ Disputa aperta sul deal *#${deal.id}*. Admin avvisato: può entrare e arbitrare con /pay_seller o /refund_buyer.`,

  disputeAdminNotify: (deal: Deal, fromId: number, fromUsername: string | undefined, link?: string) =>
    `🚨 Disputa deal #${deal.id}
Da: ${fromUsername ? `@${fromUsername}` : fromId} (${fromId})
Importo: ${deal.amount} ${deal.asset}
Stato: ${deal.status}
Gruppo: ${deal.groupChatId ?? "n/d"}
${link ? `Link one-time admin:\n${link}` : "Nessun link (bot senza permesso invita)."}

In gruppo: /pay_seller o /refund_buyer (potere admin in disputa).`,

  adminMissing:
    "Disputa registrata, ma ADMIN_TELEGRAM_ID non è configurato.",

  groupTitle: (deal: Deal) => `Escrow #${deal.id} · ${deal.amount} ${deal.asset}`,
} as const;

export function statusLabel(status: Deal["status"]): string {
  const map: Record<Deal["status"], string> = {
    awaiting_group: "crea il gruppo",
    awaiting_bot_admin: "promuovi il bot admin",
    awaiting_counterpart: "in attesa controparte",
    awaiting_deposit: "in attesa deposito",
    funded: "fondato",
    release_pending: "pay_seller in corso",
    refund_pending: "refund in corso",
    released: "rilasciato",
    refunded: "rimborsato",
    disputed: "in disputa",
    cancelled: "annullato",
  };
  return map[status];
}
