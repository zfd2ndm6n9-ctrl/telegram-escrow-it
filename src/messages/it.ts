import type { Deal } from "../types.js";
import {
  amountConfirmed,
  bothPartiesPresent,
  escMd,
  formatTosBullets,
  mentionCounterpart,
  mentionPendingVoter,
  mentionUser,
  missingEssentialTerms,
  tosAccepted,
  type EssentialTermsField,
} from "../services/deal-logic.js";

const ESSENTIAL_LABELS: Record<EssentialTermsField, string> = {
  product: "Prodotto",
  price: "Prezzo",
  tempi: "Tempi",
};

function formatMissingList(fields: EssentialTermsField[]): string {
  return fields.map((f) => `*${ESSENTIAL_LABELS[f]}*`).join(", ");
}

const STATUS_LABELS: Record<Deal["status"], string> = {
  awaiting_group: "in attesa gruppo",
  awaiting_bot_admin: "permessi bot incompleti",
  awaiting_counterpart: "in attesa controparte",
  awaiting_tos: "in attesa termini",
  awaiting_tos_confirm: "in attesa conferma termini",
  awaiting_amount: "in attesa importo",
  awaiting_amount_confirm: "in attesa conferma importo",
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

function openerMention(deal: Deal): string {
  const role = deal.creatorRole;
  const username =
    role === "buyer" ? deal.buyerUsername : deal.sellerUsername;
  const id = role === "buyer" ? deal.buyerId : deal.sellerId;
  return mentionUser(username ?? deal.creatorUsername, id ?? deal.creatorId, role);
}

function amountLine(deal: Deal): string {
  if (amountConfirmed(deal) || deal.amount) {
    return `• Importo: *${deal.amount} ${deal.asset}*`;
  }
  return `• Crypto: *${deal.asset}* · importo da confermare nel gruppo`;
}

/** Buyer + importo + indirizzo escrow su riga propria in `code` (Copia su mobile). */
function depositPrompt(deal: Deal): string {
  const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "Buyer");
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

1. In privato: /crea → ruolo (buyer/seller) → crypto
2. Crea un *gruppo privato*, aggiungi bot + controparte, poi /avvia
3. Nel gruppo: termini (messaggio libero) → Accetto → importo escrow se manca → wallet → deposito
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
    "Invia `/wallet` seguito dal tuo indirizzo Solana.",
  invalidAmount:
    "Importo non valido. Invia un numero positivo in SOL (es. `0.01`).",
  invalidWallet:
    "Indirizzo Solana non valido. Usa `/wallet` seguito dall'indirizzo base58.",
  solanaNotConfigured:
    "Escrow SOL non configurato sul server. Avvisa il supporto.",
  cancelled: "Operazione annullata.",
  unknownPrivate: "Non ho capito. Usa /menu oppure /aiuto.",

  /** Post-crea (senza importo in DM): istruzioni gruppo manuale. */
  afterAmountInstructions: (deal: Deal) =>
    `✅ Deal *#${deal.id}* pronto.

• Ruolo: *${deal.creatorRole}*
• Crypto: *${deal.asset}*

Ora:
1. Crea un *gruppo privato*
2. Aggiungi questo bot al gruppo
3. Nel gruppo: /avvia

Poi invita l'altra parte.`,

  groupReady: (deal: Deal, inviteLink: string, creatorInvited: boolean) =>
    `✅ Gruppo escrow pronto per deal *#${deal.id}*.

${creatorInvited ? "Ti ho già aggiunto al gruppo.\n" : ""}*Link invito* (max 2 — condividilo con l'altra parte):
${inviteLink}

Nel gruppo: /avvia → termini → wallet → deposito.
Verifica sempre l'indirizzo escrow nei messaggi del bot.`,

  groupCreateFailed: (deal: Deal, detail: string) =>
    `⚠️ Deal *#${deal.id}* pronto, ma la creazione automatica del gruppo non è riuscita.

\`${escMd(detail)}\`

Usa il percorso manuale: crea un gruppo privato → aggiungi il bot → /avvia.`,

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

  /**
   * Unica card vivente nel gruppo (elenco puntato).
   * Buyer/Seller/Prodotto/Prezzo€/Tempi/Condizioni; azione breve sotto; Accetto in button.
   */
  groupSetupCard: (deal: Deal) => {
    const header = `🔒 Deal *#${deal.id}* · *${deal.asset}*`;

    if (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") {
      return `${header}

Ruoli automatici: *buyer* + *seller* (+ bot).
Invita la controparte; se è già nel gruppo, che scriva un messaggio, poi /avvia.`;
    }

    const opener = openerMention(deal);
    const cp = mentionCounterpart(deal);
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");

    const bullets = [
      `• Buyer: ${buyer}`,
      `• Seller: ${seller}`,
      formatTosBullets(deal),
    ].join("\n");

    let action: string;
    if (
      tosAccepted(deal) &&
      (deal.status === "awaiting_amount" ||
        (!amountConfirmed(deal) && !deal.amount))
    ) {
      action = `${opener}: invia l'importo escrow in *${deal.asset}* (es. \`0.05\`).`;
    } else if (tosAccepted(deal)) {
      action = `Prossimo: wallet — prima ${seller}, poi ${buyer}.`;
    } else if (
      deal.status === "awaiting_tos_confirm" &&
      (deal.tosText ||
        (deal.tosProduct && deal.priceEur && deal.tosConditions))
    ) {
      action = `${cp}: *Accetto* per confermare.`;
    } else {
      const missing = missingEssentialTerms(deal);
      if (missing.length > 0 && missing.length < 3) {
        action = `${opener}: manca ancora ${formatMissingList(missing)}.`;
      } else {
        action = `${opener}: invia i termini in un unico messaggio.`;
      }
    }

    return `${header}\n${bullets}\n\n${action}`;
  },

  autoBindTooMany:
    "Troppi membri. Solo *buyer*, *seller* e il bot. Rimuovi gli altri, poi /avvia.",

  autoBindNone:
    "Manca la controparte. Invitala nel gruppo, poi /avvia.",

  autoBindNeedMessage:
    "Controparte non ancora riconosciuta. Che scriva un messaggio nel gruppo, poi /avvia.",

  tosAccepted: (deal: Deal) =>
    `✅ Termini accettati (#${deal.id}).

Prossimo: wallet — prima seller, poi buyer.`,

  tosLocked:
    "Termini già accettati: non si possono più modificare.",

  askSellerWallet: (deal: Deal) => {
    const who = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `👛 *Seller* (${who}): invia \`/wallet\` seguito dal tuo indirizzo *${deal.asset}*.`;
  },

  askBuyerWallet: (deal: Deal) => {
    const who = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `👛 *Buyer* (${who}): invia \`/wallet\` seguito dal tuo indirizzo *${deal.asset}*.`;
  },

  walletSaved: (deal: Deal, role: string, address: string) =>
    `👛 Wallet *${role}* salvato (#${deal.id}):\n\`${address}\``,

  walletWrongTurn: (deal: Deal, expected: "seller" | "buyer") => {
    const who =
      expected === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Ora tocca a ${who} impostare il wallet.`;
  },

  notReadyForDeposit:
    "L'indirizzo escrow appare dopo termini e wallet di seller e buyer.",

  onlyOpenerWritesTerms: (deal: Deal) => {
    const opener = openerMention(deal);
    const cp = mentionCounterpart(deal);
    return `Solo ${opener} propone i termini. ${cp}: usa *Accetto* a proposta completa.`;
  },

  tosTooShort:
    "Troppo corto. Scrivi *Prodotto* e *Tempi* più chiari.",

  /** Fallback raro: messaggio senza campi riconoscibili. */
  termsNeedEssentials:
    "Non ho trovato abbastanza. Indica almeno *Prodotto*, *Prezzo* (€) e *Tempi* nello stesso messaggio.",

  invalidTermsPrice:
    "Prezzo non valido. Usa un importo in *euro* (es. `5`, `5€`, `12,50`).",

  askEscrowAmount: (deal: Deal) => {
    const opener = openerMention(deal);
    return `${opener}: invia l'importo escrow in *${deal.asset}* (es. \`0.05\`).`;
  },

  invalidEscrowAmount: (asset: string) =>
    `Importo escrow non valido. Invia un numero positivo in *${asset}* (es. \`0.05\`).`,

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
      ? `Conferma *1/2* — *pay_seller* (#${deal.id}). Aspetta ${mentionPendingVoter(deal, deal.releaseVotes)}.`
      : `🔓 Rilascio al seller in corso (#${deal.id})…`,

  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `Conferma *1/2* — *refund_buyer* (#${deal.id}). Aspetta ${mentionPendingVoter(deal, deal.refundVotes)}.`
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

  adminOnly: "Solo admin.",

  ripristinaUsage:
    "Uso: `/ripristina <dealId>` nel gruppo escrow (solo admin).\nEs: `/ripristina 82978c05`",

  ripristinaUnknown: (dealId: string) =>
    `Nessun profilo orfano per *#${dealId}*. Usa \`npm run recover:escrow\` oppure aggiungi il profilo.`,

  ripristinaMismatch: (dealId: string, expected: string, derived: string) =>
    `❌ Escrow derivato diverso dall'atteso per *#${dealId}*.\nAtteso: \`${expected}\`\nDerivato: \`${derived}\`\nNon procedere: verifica che la master key su Render sia quella originale.`,

  ripristinaOk: (deal: Deal, balanceSol: string) =>
    `✅ Deal *#${deal.id}* ricollegato a questo gruppo.\nStato: \`${deal.status}\` · saldo escrow ~*${balanceSol} SOL*\nSeller: \`${deal.sellerWallet}\`\nBuyer: \`${deal.buyerWallet}\`\nPoi: /payseller o /refundbuyer (o /admin_payout).`,

  adminPayoutUsage:
    "Uso (solo admin): `/admin_payout <dealId> seller|buyer`\nEs: `/admin_payout 82978c05 seller`",

  wrongStatus: (status: string) =>
    `Azione non disponibile in \`${status}\`.`,

  notParty: "Solo buyer/seller (o admin in disputa).",
  notCreator: "Solo chi ha preparato il deal in privato può usare /avvia.",
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
  counterpartIsOpener: "Chi ha avviato il deal non conferma come controparte.",
  counterpartTaken: "La controparte è già assegnata.",
  tosOpenerCannotAccept: (deal: Deal) =>
    `I termini li accetta ${mentionCounterpart(deal)}.`,
  tosAlreadyAccepted: "Termini già accettati.",
  amountAlreadyConfirmed: "Importo già confermato.",
  amountOnlyParties: "Solo buyer e seller.",

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
Importo: ${deal.amount || "n/d"} ${deal.asset}
Escrow: ${deal.escrowAddress}
Stato: ${deal.status}
Gruppo: ${deal.groupChatId ?? "n/d"}
${link ? `Link one-time admin:\n${link}` : "Nessun link (bot senza permesso invita)."}

In gruppo: /pay_seller o /refund_buyer (potere admin in disputa).`,

  adminMissing: "Disputa registrata, ma ADMIN_TELEGRAM_ID non è configurato.",

  botAddedHint:
    "Bot nel gruppo. Buyer o seller che ha preparato il deal in privato: /avvia (servono i permessi admin).",

  groupTitle: (deal: Deal) =>
    deal.amount
      ? `Escrow #${deal.id} · ${deal.amount} ${deal.asset}`
      : `Escrow #${deal.id}`,
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
    amountLine(deal),
    `• Buyer ${buyer} · Seller ${seller}`,
    `• Escrow: \`${deal.escrowAddress}\``,
  ];
  if (deal.payoutTxSig) {
    lines.push(`• Tx: \`${deal.payoutTxSig}\``);
  }
  return lines.join("\n");
}
