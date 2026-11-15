import type { Deal } from "../types.js";

/** Escape minimo per testo utente in Markdown legacy Telegram. */
function escMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

/** Buyer + importo + indirizzo escrow su riga propria in `code` (Copia su mobile). */
function depositPrompt(deal: Deal): string {
  const buyer = deal.buyerUsername
    ? `@${deal.buyerUsername}`
    : deal.buyerId
      ? `\`${deal.buyerId}\``
      : "Buyer";
  return `${buyer}, paga *${deal.amount} ${deal.asset}* a questo indirizzo:

\`${deal.escrowAddress}\``;
}

export const it = {
  welcome: `Ciao, benvenuto su Escrowita.

Dopo /crea il bot apre un *gruppo privato* del deal e ti manda il *link invito* da condividere con la controparte. In disputa: entra il supporto.

Comandi (in privato):
/crea — prepara un nuovo escrow
/miei — i tuoi deal
/aiuto — guida`,

  help: `*Guida*

1. In privato: /crea → ruolo (buyer/seller) → crypto (SOL/ETH/LTC) → importo (*niente wallet in DM*)
2. Il bot crea il gruppo e ti manda il *link invito* (condividilo con la controparte)
3. Nel gruppo: conferma ruolo → *ToS del deal* → wallet seller poi buyer → deposito
4. Indirizzo escrow + deposito → /pay_seller o /refund_buyer (doppia conferma)

Asset: *SOL* live (mainnet). *ETH* e *LTC* presto disponibili. Niente USDT.`,

  askRole: "Che ruolo hai in questo deal?",
  askAsset: "Con quale crypto vuoi fare l'escrow?",
  assetComingSoon: (asset: string) =>
    `*${asset}* sarà presto disponibile. Per ora scegli *SOL*.`,
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

  /** Post-importo: deal pronto, gruppo in creazione (nessuno “crea gruppo / aggiungi bot”). */
  afterAmountInstructions: (deal: Deal) =>
    `✅ Deal *#${deal.id}* preparato.

• Ruolo tuo: *${deal.creatorRole}*
• Importo: *${deal.amount} ${deal.asset}*

Sto creando il gruppo escrow…`,

  groupReady: (deal: Deal, inviteLink: string, creatorInvited: boolean) =>
    `✅ Gruppo escrow pronto per deal *#${deal.id}*.

${creatorInvited ? "Ti ho già aggiunto al gruppo.\n" : ""}*Link invito* (max 2 persone — condividilo con la controparte):
${inviteLink}

Nel gruppo: la controparte conferma il ruolo → *ToS* → wallet seller poi buyer → deposito.
In disputa entra il *supporto*.

Verifica sempre l'indirizzo escrow prima di inviare ${deal.asset}.`,

  groupCreateFailed: (deal: Deal, detail: string) =>
    `❌ Deal *#${deal.id}* creato ma *non* riesco ad aprire il gruppo.

\`${escMd(detail)}\`

Avvisa l'admin (helper MTProto / permessi). Il deal resta in attesa di gruppo.`,

  tosComingSoon:
    "📄 *Termini di servizio* della piattaforma: in arrivo. I ToS *del singolo deal* si stabiliscono nel gruppo dopo la conferma del ruolo.",

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

  stabilizeTos: (deal: Deal) =>
    `📜 *Stabiliamo i ToS* — deal *#${deal.id}*

Chi ha aperto il deal (@${deal.creatorUsername ?? deal.creatorId}): scrivi qui i termini dell'accordo (cosa viene scambiato, tempi, condizioni).

La controparte li confermerà con un pulsante. Solo dopo chiederemo i wallet.`,

  tosDraftPosted: (deal: Deal) =>
    `📜 *ToS proposti* per deal *#${deal.id}* (dal creatore):

${escMd(deal.tosText ?? "")}

Controparte: tocca *Accetto i ToS* per confermare.
Il creatore può reinviare un nuovo testo per sostituirli prima della conferma.`,

  tosAccepted: (deal: Deal) =>
    `✅ ToS accettati sul deal *#${deal.id}*.

Prossimo passo: i wallet *${deal.asset}* (seller prima, poi buyer).`,

  askSellerWallet: (deal: Deal) => {
    const who = deal.sellerUsername
      ? `@${deal.sellerUsername}`
      : deal.sellerId
        ? `\`${deal.sellerId}\``
        : "seller";
    return `👛 *Seller* (${who}): invia il tuo wallet *${deal.asset}* con:
\`/wallet IndirizzoSolana\`
oppure incolla qui l'indirizzo.`;
  },

  askBuyerWallet: (deal: Deal) => {
    const who = deal.buyerUsername
      ? `@${deal.buyerUsername}`
      : deal.buyerId
        ? `\`${deal.buyerId}\``
        : "buyer";
    return `👛 *Buyer* (${who}): invia il tuo wallet *${deal.asset}* con:
\`/wallet IndirizzoSolana\`
oppure incolla qui l'indirizzo.`;
  },

  walletSaved: (deal: Deal, role: string, address: string) =>
    `👛 Wallet *${role}* salvato per #${deal.id}:\n\`${address}\``,

  walletWrongTurn: (expected: "seller" | "buyer") =>
    `Ora tocca al *${expected}* impostare il wallet. Attendi il tuo turno.`,

  notReadyForDeposit:
    "L'indirizzo escrow appare solo dopo ToS accettati e wallet di seller e buyer.",

  onlyCreatorWritesTos:
    "Solo chi ha creato il deal può scrivere i ToS. Controparte: attendi e conferma con il pulsante.",

  tosTooShort:
    "ToS troppo corti. Scrivi almeno qualche riga chiara sulle condizioni del deal.",

  dealActivated: depositPrompt,
  depositAddress: depositPrompt,

  depositDetected: (deal: Deal, balanceSol: string) =>
    `💰 Deposito *rilevato on-chain* sul deal *#${deal.id}*.

• Saldo escrow: *${balanceSol} SOL*
• Atteso: *${deal.amount} SOL*

Ora: /pay_seller oppure /refund_buyer — serve conferma di *entrambe* le parti.`,

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
    "Nessun deal collegato. In privato col bot fai /crea (il bot apre il gruppo).",
  alreadyBound: "Questo gruppo è già collegato a un deal.",
  alreadyActivated: "Il deal in questo gruppo è già avviato.",
  counterpartIsCreator: "Il creatore del deal non può confermare come controparte.",
  counterpartTaken: "La controparte è già confermata.",
  tosCreatorCannotAccept: "Il creatore ha già proposto i ToS: deve accettarli la controparte.",
  tosAlreadyAccepted: "I ToS di questo deal sono già accettati.",

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
    "Bot nel gruppo. Se il deal non è già partito, chi l'ha preparato in privato può usare /avvia.",

  groupTitle: (deal: Deal) => `Escrow #${deal.id} · ${deal.amount} ${deal.asset}`,
} as const;

export function statusLabel(status: Deal["status"]): string {
  const map: Record<Deal["status"], string> = {
    awaiting_group: "in attesa gruppo",
    awaiting_bot_admin: "permessi bot incompleti",
    awaiting_counterpart: "in attesa conferma controparte",
    awaiting_tos: "in attesa ToS dal creatore",
    awaiting_tos_confirm: "in attesa conferma ToS",
    awaiting_seller_wallet: "in attesa wallet seller",
    awaiting_buyer_wallet: "in attesa wallet buyer",
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
