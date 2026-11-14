import type { Deal } from "../types.js";

export const it = {
  welcome: `Ciao! Sono il bot di *escrow crypto* (Italia).

Tu e la controparte create un *gruppo privato* (max 2 persone), aggiungete il bot al gruppo, poi gestite il deal lì.
In caso di disputa va aggiunto il *supporto*.

Comandi (in privato):
/crea — prepara un nuovo escrow
/miei — i tuoi deal
/aiuto — guida`,

  help: `*Guida*

1. In privato: /crea → ruolo (buyer/seller) + importo USDT
2. Crea un gruppo privato e invita solo la controparte (max 2)
3. Aggiungi il bot al gruppo (pulsante dopo /crea)
4. Leggi i ToS prima di ogni deal
5. Nel gruppo: comandi escrow; in disputa aggiungete il supporto

Asset MVP: USDT (placeholder).`,

  askRole: "Che ruolo hai in questo deal?",
  askAmount: "Quanto vuoi mettere in escrow? Importo in USDT (es. `100` o `50.5`).",
  invalidAmount: "Importo non valido. Invia un numero positivo (es. `100` o `12.5`).",
  cancelled: "Operazione annullata.",
  unknownPrivate: "Non ho capito. Usa /aiuto oppure i pulsanti del menu.",

  /** Un solo messaggio post-importo: 4 passi + pulsanti (bot / ToS) */
  afterAmountInstructions: (deal: Deal) =>
    `✅ Deal *#${deal.id}* preparato.

• Ruolo tuo: *${deal.creatorRole}*
• Importo: *${deal.amount} ${deal.asset}*

*Passi:*
1. Crea un gruppo privato e invita solo la controparte (max 2 persone)
2. Aggiungi il bot al gruppo con il pulsante qui sotto
3. Leggi i *ToS* prima di ogni deal
4. Se ci sono dispute, aggiungete il *supporto* al gruppo: sistemerà la situazione`,

  tosComingSoon:
    "📄 *Termini di servizio*: in arrivo. Prima di ogni deal ti chiederemo di leggerli qui.",

  needBotAdmin:
    "⚠️ Sono nel gruppo ma *non sono amministratore*. Promuovimi ad admin, poi reinvia /avvia.",

  askCounterpartConfirm: (deal: Deal) => {
    const role = deal.creatorRole === "buyer" ? "seller" : "buyer";
    return `🔐 Deal *#${deal.id}* collegato a questo gruppo.

• Importo: *${deal.amount} ${deal.asset}*
• Creatore: *${deal.creatorRole}*

Controparte: tocca il pulsante per confermare come *${role}*.
(Devono esserci solo buyer + seller + bot — niente altri utenti.)`;
  },

  dealActivated: (deal: Deal) =>
    `🤝 Deal *#${deal.id}* avviato.

• Buyer: ${deal.buyerUsername ? `@${deal.buyerUsername}` : deal.buyerId}
• Seller: ${deal.sellerUsername ? `@${deal.sellerUsername}` : deal.sellerId}
• Importo: *${deal.amount} ${deal.asset}*

Indirizzo escrow (mock MVP):
\`${deal.escrowAddress}\`

Poi: «Segna depositato» / /depositato → /pay_seller o /refund_buyer (doppia conferma).`,

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
  notCreator: "Solo chi ha creato il deal in privato può usare /avvia.",
  dealNotFound: "Deal non trovato.",
  noDeals: "Nessun deal. Usa /crea in chat privata con il bot.",
  onlyPrivate: "Questo comando va usato in *chat privata* con il bot.",
  onlyGroup: "Questo comando va usato nel *gruppo escrow*.",
  noDealInGroup:
    "Nessun deal da avviare. In privato col bot fai /crea, poi qui /avvia.",
  alreadyBound: "Questo gruppo è già collegato a un deal.",
  alreadyActivated: "Il deal in questo gruppo è già avviato.",
  counterpartIsCreator: "Il creatore del deal non può confermare come controparte.",
  counterpartTaken: "La controparte è già confermata.",

  kickedExtra: (userId: number) =>
    `🚫 Utente \`${userId}\` rimosso: ammessi solo buyer, seller e (in disputa) admin.`,

  disputeOpened: (deal: Deal) =>
    `⚠️ Disputa aperta sul deal *#${deal.id}*. Admin avvisato: può entrare e arbitrare con /pay_seller o /refund_buyer.`,

  disputeAdminNotify: (
    deal: Deal,
    fromId: number,
    fromUsername: string | undefined,
    link?: string,
  ) =>
    `🚨 Disputa deal #${deal.id}
Da: ${fromUsername ? `@${fromUsername}` : fromId} (${fromId})
Importo: ${deal.amount} ${deal.asset}
Stato: ${deal.status}
Gruppo: ${deal.groupChatId ?? "n/d"}
${link ? `Link one-time admin:\n${link}` : "Nessun link (bot senza permesso invita)."}

In gruppo: /pay_seller o /refund_buyer (potere admin in disputa).`,

  adminMissing: "Disputa registrata, ma ADMIN_TELEGRAM_ID non è configurato.",

  botAddedHint:
    "Bot aggiunto. Chi ha preparato il deal in privato: invia /avvia per collegarlo a questo gruppo (dopo avermi reso admin).",

  groupTitle: (deal: Deal) => `Escrow #${deal.id} · ${deal.amount} ${deal.asset}`,
} as const;

export function statusLabel(status: Deal["status"]): string {
  const map: Record<Deal["status"], string> = {
    awaiting_group: "crea gruppo + aggiungi bot",
    awaiting_bot_admin: "promuovi il bot admin",
    awaiting_counterpart: "in attesa conferma controparte",
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
