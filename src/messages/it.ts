import type { Deal } from "../types.js";

/** Escape minimo per testo utente in Markdown legacy Telegram. */
function escMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

const STATUS_LABELS: Record<Deal["status"], string> = {
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

/** Buyer + importo + indirizzo escrow su riga propria in `code` (Copia su mobile). */
function depositPrompt(deal: Deal): string {
  const buyer = deal.buyerUsername
    ? `@${deal.buyerUsername}`
    : deal.buyerId
      ? `\`${deal.buyerId}\``
      : "Buyer";
  return `${buyer}, paga *${deal.amount} ${deal.asset}* a questo indirizzo:

\`${deal.escrowAddress}\`

⚠️ Controlla l'indirizzo *solo* nei messaggi di Escrowita in questo gruppo.`;
}

export const it = {
  welcome: `Ciao, benvenuto su *Escrowita*.

Escrow crypto tra due parti già d'accordo.

/crea — nuovo deal
/miei — i tuoi deal
/menu — comandi
/aiuto — guida`,

  help: `*Guida Escrowita*

1. In privato: /crea → ruolo → crypto → importo
2. Crea un *gruppo privato*, aggiungi il bot come *admin*, poi /avvia
3. Nel gruppo: conferma ruolo → ToS → wallet seller poi buyer → deposito
4. /pay_seller (o /payseller) · /refund_buyer (o /refundbuyer) — doppia conferma

Asset: *SOL* live. *ETH* e *LTC* presto.
In dubbio: /dispute o /support.`,

  menuDm: `*Menu Escrowita*

/crea — nuovo escrow
/miei — i tuoi deal
/aiuto — guida
/support — supporto`,

  menuGroup: `*Comandi nel gruppo*

/stato — stato deal
/indirizzo — indirizzo escrow
/depositato — verifica deposito
/payseller · /refundbuyer — doppia conferma
/blockchain — link tx
/dispute · /support
/menu — questo elenco`,

  askRole: "Che ruolo hai in questo deal?",
  askAsset: "Con quale crypto vuoi fare l'escrow?",
  assetComingSoon: (asset: string) =>
    `*${asset}* sarà presto disponibile. Per ora scegli *SOL*.`,
  askAmount:
    "Quanto vuoi mettere in escrow? Importo in *SOL* (es. `0.01`).\n⚠️ Mainnet reale: usa importi di test piccoli.",
  askWallet:
    "Invia il tuo *indirizzo wallet Solana* (base58).",
  invalidAmount:
    "Importo non valido. Invia un numero positivo in SOL (es. `0.01`).",
  invalidWallet:
    "Indirizzo Solana non valido. Incolla un indirizzo base58.",
  solanaNotConfigured:
    "Escrow SOL non configurato sul server. Avvisa il supporto.",
  cancelled: "Operazione annullata.",
  unknownPrivate: "Non ho capito. Usa /menu oppure /aiuto.",

  /** Post-importo: istruzioni gruppo manuale. */
  afterAmountInstructions: (deal: Deal) =>
    `✅ Deal *#${deal.id}* pronto.

• Ruolo: *${deal.creatorRole}*
• Importo: *${deal.amount} ${deal.asset}*

Ora:
1. Crea un *gruppo privato*
2. Aggiungi questo bot come *amministratore*
3. Nel gruppo: /avvia

Poi invita solo la controparte.`,

  groupReady: (deal: Deal, inviteLink: string, creatorInvited: boolean) =>
    `✅ Gruppo escrow pronto per deal *#${deal.id}*.

${creatorInvited ? "Ti ho già aggiunto al gruppo.\n" : ""}*Link invito* (max 2 — condividilo con la controparte):
${inviteLink}

Nel gruppo: conferma ruolo → ToS → wallet → deposito.
Verifica sempre l'indirizzo escrow nei messaggi del bot.`,

  groupCreateFailed: (deal: Deal, detail: string) =>
    `⚠️ Deal *#${deal.id}* pronto, ma la creazione automatica del gruppo non è riuscita.

\`${escMd(detail)}\`

Usa il percorso manuale: crea un gruppo privato → aggiungi il bot admin → /avvia.`,

  tosComingSoon:
    "📄 Termini della piattaforma: in arrivo. I ToS del deal si fissano nel gruppo.",

  needBotAdmin:
    "⚠️ Promuovimi ad *amministratore* (Elimina messaggi, Blocca utenti, Invita utenti), poi /avvia.",

  missingBotPerms: (missing: string[]) => {
    const labels: Record<string, string> = {
      can_delete_messages: "Elimina messaggi",
      can_restrict_members: "Blocca utenti",
      can_invite_users: "Invita utenti",
    };
    const lines = missing.map((k) => `• ${labels[k] ?? k}`);
    return `⚠️ Servono permessi admin.

Promuovimi con:
• Elimina messaggi
• Blocca utenti
• Invita utenti

*Manca ancora:*
${lines.join("\n")}

Poi /avvia.`;
  },

  askCounterpartConfirm: (deal: Deal) => {
    const role = deal.creatorRole === "buyer" ? "seller" : "buyer";
    return `🔐 Deal *#${deal.id}* collegato.

• Importo: *${deal.amount} ${deal.asset}*
• Creatore: *${deal.creatorRole}*

Controparte: conferma come *${role}*.
Solo buyer + seller (+ bot).`;
  },

  stabilizeTos: (deal: Deal) =>
    `📜 *ToS del deal* — *#${deal.id}*

@${deal.creatorUsername ?? deal.creatorId}: scrivi qui i termini (cosa, tempi, condizioni).

La controparte conferma col pulsante. Poi i wallet.`,

  tosDraftPosted: (deal: Deal) =>
    `📜 *ToS proposti* (#${deal.id}):

${escMd(deal.tosText ?? "")}

Controparte: *Accetto i ToS*.
Il creatore può sostituirli inviando un nuovo testo.`,

  tosAccepted: (deal: Deal) =>
    `✅ ToS accettati (#${deal.id}).

Prossimo: wallet *${deal.asset}* — prima seller, poi buyer.`,

  askSellerWallet: (deal: Deal) => {
    const who = deal.sellerUsername
      ? `@${deal.sellerUsername}`
      : deal.sellerId
        ? `\`${deal.sellerId}\``
        : "seller";
    return `👛 *Seller* (${who}): wallet *${deal.asset}* con \`/wallet Indirizzo\` oppure incolla l'indirizzo.`;
  },

  askBuyerWallet: (deal: Deal) => {
    const who = deal.buyerUsername
      ? `@${deal.buyerUsername}`
      : deal.buyerId
        ? `\`${deal.buyerId}\``
        : "buyer";
    return `👛 *Buyer* (${who}): wallet *${deal.asset}* con \`/wallet Indirizzo\` oppure incolla l'indirizzo.`;
  },

  walletSaved: (deal: Deal, role: string, address: string) =>
    `👛 Wallet *${role}* salvato (#${deal.id}):\n\`${address}\``,

  walletWrongTurn: (expected: "seller" | "buyer") =>
    `Ora tocca al *${expected}* impostare il wallet.`,

  notReadyForDeposit:
    "L'indirizzo escrow appare dopo ToS e wallet di seller e buyer.",

  onlyCreatorWritesTos:
    "Solo chi ha creato il deal scrive i ToS. Controparte: usa il pulsante.",

  tosTooShort:
    "ToS troppo corti. Scrivi condizioni chiare in qualche riga.",

  dealActivated: depositPrompt,
  depositAddress: depositPrompt,

  depositDetected: (deal: Deal, balanceSol: string) =>
    `💰 Deal *#${deal.id}* fondato (*${balanceSol} SOL*).

Entrambe le parti: /payseller oppure /refundbuyer (doppia conferma).`,

  depositCheckResult: (
    deal: Deal,
    balanceSol: string,
    funded: boolean,
  ) =>
    funded
      ? `✅ #${deal.id} fondato: *${balanceSol} SOL*.`
      : `⏳ #${deal.id}: *${balanceSol}* / *${deal.amount} SOL*\n\`${deal.escrowAddress}\``,

  markFundedAdmin: (deal: Deal) =>
    `💰 Admin: #${deal.id} forzato a *funded*.`,

  releaseVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Conferma *1/2* — *pay_seller* (#${deal.id}). Aspetta la controparte.`
      : `🔓 Rilascio al seller in corso (#${deal.id})…`,

  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Conferma *1/2* — *refund_buyer* (#${deal.id}). Aspetta la controparte.`
      : `↩️ Rimborso al buyer in corso (#${deal.id})…`,

  payoutSuccess: (deal: Deal, kind: "release" | "refund", sig: string, sol: string) =>
    kind === "release"
      ? `✅ *Rilascio completato* (#${deal.id}).\n*${sol} SOL* → seller \`${deal.sellerWallet}\`\nTx: \`${sig}\``
      : `✅ *Rimborso completato* (#${deal.id}).\n*${sol} SOL* → buyer \`${deal.buyerWallet}\`\nTx: \`${sig}\``,

  payoutFailed: (deal: Deal, error: string) =>
    `❌ Payout non riuscito (#${deal.id}).\n${error}`,

  needWallet: (who: "buyer" | "seller") =>
    `Manca il wallet del *${who}*. Usa \`/wallet Indirizzo\`.`,

  adminForceRelease: (deal: Deal) =>
    `🔓 Admin: *pay_seller* su #${deal.id}…`,
  adminForceRefund: (deal: Deal) =>
    `↩️ Admin: *refund_buyer* su #${deal.id}…`,

  wrongStatus: (status: string) =>
    `Azione non disponibile in \`${status}\`.`,

  notParty: "Solo buyer/seller (o admin in disputa).",
  notCreator: "Solo chi ha creato il deal può usare /avvia.",
  dealNotFound: "Deal non trovato.",
  noDeals: "Nessun deal. Usa /crea in privato.",
  onlyPrivate: "Usa questo comando in *chat privata* con il bot.",
  onlyGroup: "Usa questo comando nel *gruppo escrow*.",
  noDealInGroup:
    "Nessun deal collegato. In privato: /crea → poi qui /avvia.",
  alreadyBound: "Questo gruppo è già collegato a un deal.",
  alreadyActivated: "Il deal in questo gruppo è già avviato.",
  /** /avvia ripetuto su deal già collegato: niente seconda card. */
  alreadyLinkedShort: (deal: Deal) =>
    `Deal *#${deal.id}* già collegato — \`${STATUS_LABELS[deal.status]}\`. Usa /stato.`,
  counterpartIsCreator: "Il creatore non può confermare come controparte.",
  counterpartTaken: "La controparte è già confermata.",
  tosCreatorCannotAccept: "I ToS li accetta la controparte.",
  tosAlreadyAccepted: "ToS già accettati.",

  kickedExtra: (userId: number) =>
    `🚫 \`${userId}\` rimosso: ammessi solo buyer, seller e (in disputa) supporto.`,

  kickedUnauthorizedBot: (username?: string) =>
    `🚫 Bot non autorizzato rimosso${username ? ` (@${escMd(username)})` : ""}. Nel gruppo escrow resta solo Escrowita.`,

  forwardBlocked:
    "⚠️ Messaggi inoltrati non ammessi nel gruppo escrow (anti-truffa).",

  identityChanged: (who: string, detail: string) =>
    `⚠️ Attenzione: *${escMd(who)}* ha cambiato identità (${escMd(detail)}). Verificate di parlare con la persona giusta.`,

  escrowVerifyHint:
    "Controlla l'indirizzo escrow *solo* nei messaggi di Escrowita in questo gruppo. Non fidarti di altri canali o forward.",

  disputeOpened: (deal: Deal) =>
    `⚠️ Disputa aperta (#${deal.id}). Supporto avvisato: può entrare e usare /pay_seller o /refund_buyer.`,

  supportGroup:
    "Supporto Escrowita: usa /dispute per aprire un caso. In disputa può entrare un operatore. Niente arbitraggio automatico «With-Admin»: se serve un umano, /dispute.",

  supportDm:
    "Supporto Escrowita: nel gruppo del deal usa /dispute. L'operatore riceve notifica e può entrare. Per dubbi sul flusso: /aiuto.",

  blockchainLink: (deal: Deal, url: string) =>
    `🔗 Tx deal *#${deal.id}*:\n${url}`,

  blockchainMissing:
    "Nessuna tx di payout ancora. Dopo /pay_seller o /refund_buyer usa di nuovo /blockchain.",

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
    "Bot nel gruppo. Chi ha preparato il deal in privato: /avvia (servono i permessi admin).",

  groupTitle: (deal: Deal) => `Escrow #${deal.id} · ${deal.amount} ${deal.asset}`,
} as const;

export function statusLabel(status: Deal["status"]): string {
  return STATUS_LABELS[status];
}

/** /stato e callback: corto, senza wall di lamports. */
export function formatDealStatus(deal: Deal): string {
  const buyer = deal.buyerUsername
    ? `@${deal.buyerUsername}`
    : deal.buyerId
      ? String(deal.buyerId)
      : "—";
  const seller = deal.sellerUsername
    ? `@${deal.sellerUsername}`
    : deal.sellerId
      ? String(deal.sellerId)
      : "—";
  const lines = [
    `*#${deal.id}* — ${STATUS_LABELS[deal.status]}`,
    `• ${deal.amount} ${deal.asset}`,
    `• Buyer ${buyer} · Seller ${seller}`,
    `• Escrow: \`${deal.escrowAddress}\``,
  ];
  if (deal.payoutTxSig) {
    lines.push(`• Tx: \`${deal.payoutTxSig}\``);
  }
  return lines.join("\n");
}
