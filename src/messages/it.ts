import type { Deal } from "../types.js";

export const it = {
  welcome: `Ciao! Sono il bot di *escrow crypto* (Italia).

Tu e la controparte create un *gruppo privato* (max 2 persone), aggiungete il bot al gruppo, poi gestite il deal lì.
In caso di disputa va aggiunto il *supporto*.

Asset MVP: *SOL (Solana mainnet)* — soldi veri.
⚠️ Hot wallet custodial: inizia con importi di *test piccoli*.

Comandi (in privato):
/crea — prepara un nuovo escrow
/miei — i tuoi deal
/aiuto — guida`,

  help: `*Guida*

1. In privato: /crea → ruolo (buyer/seller) + importo SOL + tuo wallet Solana
2. Crea un gruppo privato e invita solo la controparte (max 2)
3. Aggiungi il bot al gruppo (pulsante dopo /crea)
4. Leggi i ToS prima di ogni deal
5. Nel gruppo: deposito SOL → rilevamento automatico → /pay_seller o /refund_buyer (doppia conferma)
6. Controparte: /wallet \`IndirizzoSolana\` per ricevere/rimborsare

Asset roadmap: *SOL* (ora) → LTC → ETH. Niente USDT.`,

  askRole: "Che ruolo hai in questo deal?",
  askAmount:
    "Quanto vuoi mettere in escrow? Importo in *SOL* (es. `0.01` o `0.05`).\n⚠️ Mainnet reale: usa importi di test piccoli.",
  askWallet:
    "Invia il tuo *indirizzo wallet Solana* (base58).\n• Se sei *buyer*: useremo questo indirizzo per un eventuale rimborso.\n• Se sei *seller*: qui riceverai il pagamento a rilascio.",
  invalidAmount:
    "Importo non valido. Invia un numero positivo in SOL (es. `0.01` o `0.05`).",
  invalidWallet:
    "Indirizzo Solana non valido. Incolla un indirizzo base58 (32–44 caratteri).",
  solanaNotConfigured:
    "Escrow SOL non configurato: manca `SOLANA_PRIVATE_KEY` sul worker. Avvisa l'admin.",
  cancelled: "Operazione annullata.",
  unknownPrivate: "Non ho capito. Usa /aiuto oppure i pulsanti del menu.",

  /** Un solo messaggio post-importo: 4 passi + pulsanti (bot / ToS) */
  afterAmountInstructions: (deal: Deal) =>
    `✅ Deal *#${deal.id}* preparato.

• Ruolo tuo: *${deal.creatorRole}*
• Importo: *${deal.amount} ${deal.asset}*
• Tuo wallet: \`${deal.creatorRole === "buyer" ? deal.buyerWallet : deal.sellerWallet}\`

*Passi:*
1. Crea un gruppo privato e invita solo la controparte (max 2 persone)
2. Aggiungi il bot al gruppo con il pulsante qui sotto
3. Leggi i *ToS* prima di ogni deal
4. Se ci sono dispute, aggiungete il *supporto* al gruppo: sistemerà la situazione

⚠️ Verifica sempre l'indirizzo escrow *nel gruppo* prima di inviare SOL.`,

  tosComingSoon:
    "📄 *Termini di servizio*: in arrivo. Prima di ogni deal ti chiederemo di leggerli qui.",

  needBotAdmin:
    "⚠️ Non posso avviare il deal: promuovimi ad *amministratore* con Elimina messaggi, Blocca utenti e Invita utenti, poi reinvia /avvia.",

  missingBotPerms: (missing: string[]) => {
    const labels: Record<string, string> = {
      can_delete_messages: "Elimina messaggi",
      can_restrict_members: "Blocca utenti",
      can_invite_users: "Invita utenti",
    };
    const lines = missing.map((k) => `• ${labels[k] ?? k}`);
    return `⚠️ *Non posso avviare il deal*: mi mancano permessi da amministratore.

Promuovimi admin con almeno:
• Elimina messaggi
• Blocca utenti
• Invita utenti

*Ti manca ancora:*
${lines.join("\n")}

Poi reinvia /avvia. Niente escrow finché non è a posto.`;
  },

  askCounterpartConfirm: (deal: Deal) => {
    const role = deal.creatorRole === "buyer" ? "seller" : "buyer";
    return `🔐 Deal *#${deal.id}* collegato a questo gruppo.

• Importo: *${deal.amount} ${deal.asset}*
• Creatore: *${deal.creatorRole}*

Controparte: tocca il pulsante per confermare come *${role}*.
(Devono esserci solo buyer + seller + bot — niente altri utenti.)`;
  },

  askCounterpartWallet: (deal: Deal) =>
    `✅ Ruolo confermato sul deal *#${deal.id}*.

Ora invia il tuo wallet Solana con:
\`/wallet IndirizzoSolanaTuo\`

Poi il buyer deposita su l'indirizzo escrow del gruppo.`,

  walletSaved: (deal: Deal, role: string, address: string) =>
    `👛 Wallet *${role}* salvato per #${deal.id}:\n\`${address}\``,

  dealActivated: (deal: Deal) =>
    `🤝 Deal *#${deal.id}* avviato.

• Buyer: ${deal.buyerUsername ? `@${deal.buyerUsername}` : deal.buyerId}
• Seller: ${deal.sellerUsername ? `@${deal.sellerUsername}` : deal.sellerId}
• Importo: *${deal.amount} ${deal.asset}* (Solana *mainnet*)

📫 *Indirizzo escrow* (unico per questo deal):
\`${deal.escrowAddress}\`

Invia *esattamente* \`${deal.amount} SOL\` (o un po' di più) a questo indirizzo.
Il bot rileva il deposito in automatico (ogni ~20s). Oppure: «Verifica deposito».

Prima del payout: entrambe le parti devono avere un wallet con /wallet.
Poi: /pay_seller o /refund_buyer (doppia conferma).

⚠️ Hot wallet custodial — importi di test piccoli. Verifica sempre l'indirizzo.`,

  depositAddress: (deal: Deal) =>
    `📫 *Indirizzo escrow SOL (mainnet)*\n\`${deal.escrowAddress}\`\n\nImporto atteso: *${deal.amount} ${deal.asset}*\n\n⚠️ Invia solo SOL su Solana mainnet. Niente token/USDT.`,

  depositDetected: (deal: Deal, balanceSol: string) =>
    `💰 Deposito *rilevato on-chain* sul deal *#${deal.id}*.

• Saldo escrow: *${balanceSol} SOL*
• Atteso: *${deal.amount} SOL*

Ora: /pay_seller oppure /refund_buyer — serve conferma di *entrambe* le parti.
Assicurati che buyer e seller abbiano impostato /wallet.`,

  depositCheckResult: (
    deal: Deal,
    balanceSol: string,
    funded: boolean,
  ) =>
    funded
      ? `✅ Deposito ok per #${deal.id}: saldo *${balanceSol} SOL* (atteso ${deal.amount}).`
      : `⏳ Ancora in attesa per #${deal.id}.\nSaldo attuale: *${balanceSol} SOL* / atteso *${deal.amount} SOL*\nIndirizzo:\n\`${deal.escrowAddress}\``,

  markFundedAdmin: (deal: Deal) =>
    `💰 Admin ha forzato lo stato *funded* sul deal *#${deal.id}* (bypass on-chain).`,

  releaseVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto *pay_seller* registrato (#${deal.id}). Manca ${remaining} conferma.`
      : `🔓 Deal *#${deal.id}* — rilascio al seller in corso on-chain…`,

  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Voto *refund_buyer* registrato (#${deal.id}). Manca ${remaining} conferma.`
      : `↩️ Deal *#${deal.id}* — rimborso al buyer in corso on-chain…`,

  payoutSuccess: (deal: Deal, kind: "release" | "refund", sig: string, sol: string) =>
    kind === "release"
      ? `🔓 *pay_seller* completato (#${deal.id}).\nInviati *${sol} SOL* a \`${deal.sellerWallet}\`\nTx: \`${sig}\``
      : `↩️ *refund_buyer* completato (#${deal.id}).\nInviati *${sol} SOL* a \`${deal.buyerWallet}\`\nTx: \`${sig}\``,

  payoutFailed: (deal: Deal, error: string) =>
    `❌ Payout on-chain fallito per #${deal.id}:\n\`${error}\`\nLo stato del deal non è stato chiuso: riprova o apri /dispute.`,

  needWallet: (who: "buyer" | "seller") =>
    `Manca il wallet Solana del *${who}*. Impostalo con:\n\`/wallet IndirizzoSolana\``,

  adminForceRelease: (deal: Deal) =>
    `🔓 Admin ha arbitrato: *pay_seller* su #${deal.id} — payout on-chain…`,
  adminForceRefund: (deal: Deal) =>
    `↩️ Admin ha arbitrato: *refund_buyer* su #${deal.id} — payout on-chain…`,

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
Escrow: ${deal.escrowAddress}
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
