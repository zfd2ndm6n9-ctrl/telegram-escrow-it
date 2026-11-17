import type { Deal, DmTermsStep } from "../types.js";
import {
  amountConfirmed,
  bothPartiesPresent,
  escMd,
  formatTosBullets,
  mentionPendingVoter,
  mentionUser,
  missingEssentialTerms,
  termsReadyForConfirm,
  tosAccepted,
  type EssentialTermsField,
} from "../services/deal-logic.js";

const ESSENTIAL_LABELS: Record<EssentialTermsField, string> = {
  product: "Prodotto",
  price: "Prezzo",
  conditions: "Condizioni",
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

function amountLine(deal: Deal): string {
  if (amountConfirmed(deal) || deal.amount) {
    return `• Escrow: *${deal.amount} ${deal.asset}*`;
  }
  if (deal.priceEur) {
    return `• Prezzo: *${deal.priceEur} €* · escrow SOL al Accetto`;
  }
  return `• Crypto: *${deal.asset}*`;
}

/** Buyer + importo + indirizzo escrow su riga propria in `code` (Copia su mobile). */
function depositPrompt(deal: Deal): string {
  const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "Buyer");
  return `${buyer}, paga *${deal.amount} ${deal.asset}* a questo indirizzo:

\`${deal.escrowAddress}\`

⚠️ Controlla l'indirizzo *solo* nei messaggi di Escrowita in questo gruppo.`;
}

export const it = {
  /** /start senza @ ancora: chiedi solo la @. */
  welcomeAskHandle: `Ciao, benvenuto su *Escrowita*.

Per iscriverti invia la tua *@* Telegram (es. \`@nome\`).`,

  askHandleAgain:
    "Invia la tua *@* Telegram (es. `@nome`), così come appare nel tuo profilo.",

  registeredOk: (username: string) =>
    `✅ Iscrizione ok — @${escMd(username)}.

Escrow crypto tra due parti già d'accordo.

/crea — nuovo deal
/miei — i tuoi deal`,

  /** Stesso profilo / @ già nota (anche dopo delete bot). */
  welcomeBack: (username?: string) =>
    username
      ? `Bentornato su *Escrowita* — @${escMd(username)}.

/crea — nuovo deal
/miei — i tuoi deal`
      : `Bentornato su *Escrowita* — sei già iscritto.

/crea — nuovo deal
/miei — i tuoi deal`,

  askInviteOptional: "Codice invito? Invia o /skip.",

  inviteRedeemOk: (code: string) =>
    `✅ Codice *${escMd(code)}* applicato.`,

  inviteRedeemAlready: (code: string) =>
    `Codice *${escMd(code)}* già attivo.`,

  inviteRedeemOther: "Hai già un codice invito.",

  inviteNotFound: "Codice non valido.",

  inviteUsage: "Uso: `/invito CODICE`.",

  inviteSkipped: "Ok, nessun codice.",

  handleMismatch: (expected?: string) =>
    expected
      ? `Usa *@${escMd(expected)}* (come nel profilo).`
      : "L'@ non corrisponde al profilo.",

  handleNeedTelegramUsername:
    "Imposta un username Telegram, poi reinviami la @.",

  handleInvalid: "@ non valida. Es. `@nome`.",

  /** Gate soft signup: solo opener (/crea, wizard termini opener, /invito). */
  needRegistration:
    "Per usare l'escrow apri una chat *privata* con il bot, invia `/start` e la tua *@*.",

  /** @deprecated alias */
  needPrivateStart:
    "Per usare l'escrow apri una chat *privata* con il bot, invia `/start` e la tua *@*.",

  iscrittiCount: (n: number) => `Iscritti: *${n}*`,

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
  unknownPrivate: "Non ho capito. Usa /crea o /miei.",

  /** Riepilogo vivente in DM seller (elenco puntato). */
  dmTermsSummary: (deal: Deal) =>
    `📋 Deal *#${deal.id}* · *${deal.asset}*\n${formatTosBullets(deal)}`,

  dmTermsAsk: (step: DmTermsStep, _deal: Deal) => {
    if (step === "product") {
      return "1️⃣ Qual è il *Prodotto*?";
    }
    if (step === "price") {
      return "2️⃣ Qual è il *Prezzo* in euro? (es. `10` o `12,50`)";
    }
    return "3️⃣ Quali sono le *Condizioni*?";
  },

  dmTermsComplete: (deal: Deal) =>
    `✅ Termini salvati per deal *#${deal.id}*.

Nel gruppo il *buyer* potrà accettare con *Accetto*.`,

  dmTermsTooShort:
    "Troppo corto. Scrivi almeno un paio di caratteri chiari.",

  dmTermsInvalidPrice:
    "Prezzo non valido. Usa un importo in *euro* (es. `5`, `5€`, `12,50`).",

  dmTermsSellerBlocked: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `${seller}: apri una chat *privata* con il bot (/start), poi rispondi alle 3 domande sui termini.`;
  },

  /** Post-crea (senza importo in DM): istruzioni gruppo manuale. */
  afterAmountInstructions: (deal: Deal) => {
    const termsNote = termsReadyForConfirm(deal)
      ? "\nTermini già compilati in privato."
      : deal.creatorRole === "buyer"
        ? "\nDopo /avvia il *seller* riceverà le 3 domande in privato."
        : "";
    return `✅ Deal *#${deal.id}* pronto.

• Ruolo: *${deal.creatorRole}*
• Crypto: *${deal.asset}*${termsNote}

Ora:
1. Crea un *gruppo privato*
2. Aggiungi questo bot al gruppo
3. Nel gruppo: /avvia

Poi invita l'altra parte.`;
  },

  groupReady: (deal: Deal, inviteLink: string, creatorInvited: boolean) =>
    `✅ Gruppo escrow pronto per deal *#${deal.id}*.

${creatorInvited ? "Ti ho già aggiunto al gruppo.\n" : ""}*Link invito* (max 2 — condividilo con l'altra parte):
${inviteLink}

Nel gruppo: /avvia (buyer o seller) → Accetto → wallet → deposito.
Verifica sempre l'indirizzo escrow nei messaggi del bot.`,

  groupCreateFailed: (deal: Deal, detail: string) =>
    `⚠️ Deal *#${deal.id}* pronto, ma la creazione automatica del gruppo non è riuscita.

\`${escMd(detail)}\`

Usa il percorso manuale: crea un gruppo privato → aggiungi il bot → /avvia.`,

  tosComingSoon:
    "📄 Termini della piattaforma: in arrivo. I ToS del deal li compila il seller in privato.",

  /** Bot non admin: una sola riga. */
  needBotAdmin: "Per iniziare il deal il bot deve essere amministratore.",

  /**
   * Admin ma senza i flag obbligatori.
   * Notifica chiara; il caller evita spam (replace / un solo hint).
   */
  missingRequiredPerms: (missing: string[]) => {
    const labels: Record<string, string> = {
      can_delete_messages: "Elimina messaggi",
      can_restrict_members: "Blocca utenti",
      can_invite_users: "Invita utenti",
    };
    const list = missing.map((k) => labels[k] ?? k).join(", ");
    return `Mancano ancora i permessi richiesti: ${list}.`;
  },

  /** Non-admin → riga corta; admin incompleto → permessi ancora mancanti. */
  missingBotPerms: (missing: string[], opts?: { notAdmin?: boolean }) => {
    if (opts?.notAdmin) {
      return "Per iniziare il deal il bot deve essere amministratore.";
    }
    const labels: Record<string, string> = {
      can_delete_messages: "Elimina messaggi",
      can_restrict_members: "Blocca utenti",
      can_invite_users: "Invita utenti",
    };
    const list = missing.map((k) => labels[k] ?? k).join(", ");
    return `Mancano ancora i permessi richiesti: ${list}.`;
  },

  /**
   * Unica card vivente nel gruppo (elenco puntato).
   * Buyer/Seller/Prodotto/Prezzo€/Condizioni; solo l'azione corrente sotto; Accetto in button.
   */
  groupSetupCard: (deal: Deal) => {
    const solHint =
      deal.amount && amountConfirmed(deal)
        ? ` · *${deal.amount} ${deal.asset}*`
        : "";
    const header = `🔒 Deal *#${deal.id}* · *${deal.asset}*${solHint}`;

    if (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") {
      return `${header}

Controparte: scrivi un messaggio — nel gruppo o fuori — per collegarti al deal.`;
    }

    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");

    const bullets = [
      `• Buyer: ${buyer}`,
      `• Seller: ${seller}`,
      formatTosBullets(deal),
    ].join("\n");

    let action: string | null = null;
    if (tosAccepted(deal)) {
      // Wallet / deposito: istruzioni in messaggi dedicati — niente spoiler qui.
      action = null;
    } else if (
      deal.status === "awaiting_tos_confirm" &&
      termsReadyForConfirm(deal)
    ) {
      action = `${buyer}: *Accetto* per confermare.`;
    } else {
      const missing = missingEssentialTerms(deal);
      if (missing.length > 0 && missing.length < 3) {
        action = `${seller}: in privato manca ancora ${formatMissingList(missing)}.`;
      } else {
        action = `${seller}: completa i termini in *chat privata* col bot.`;
      }
    }

    return action
      ? `${header}\n${bullets}\n\n${action}`
      : `${header}\n${bullets}`;
  },

  autoBindTooMany:
    "Troppi membri. Solo *buyer*, *seller* e il bot. Rimuovi gli altri, poi /avvia.",

  /** Controparte assente: invita a scrivere (o entrare poi). */
  autoBindNone:
    "Controparte: scrivi un messaggio — nel gruppo o fuori — per collegarti al deal.",

  /** Controparte già in gruppo: deve scrivere per bind (niente discovery silenziosa). */
  autoBindNeedMessage:
    "Controparte: scrivi un messaggio nel gruppo per collegarti al deal.",

  tosAccepted: (deal: Deal) =>
    deal.amount
      ? `✅ Termini accettati (#${deal.id}). Escrow: *${deal.amount} ${deal.asset}*.`
      : `✅ Termini accettati (#${deal.id}).`,

  tosLocked:
    "Termini già accettati: non si possono più modificare.",

  /** Conversione €→SOL fallita al momento dell'Accetto. */
  rateUnavailable:
    "Tasso €→SOL non disponibile al momento. Riprova tra poco con *Accetto*.",

  missingCommercialPrice:
    "Manca il prezzo in euro (termini DM). Il seller deve completare *Prezzo* in privato.",

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

  /** Dopo deposito / funded: wallet bloccati (anti-swap destinazione payout). */
  walletLockedAfterDeposit: (deal: Deal) =>
    `Wallet bloccati per #${deal.id} (deposito già attivo o completato). Per cambiare destinazione apri /dispute.`,

  payoutBusy: (deal: Deal) =>
    `Payout già in corso per #${deal.id}. Attendi qualche secondo.`,

  payoutReconciledEmpty: (deal: Deal) =>
    deal.payoutTxSig
      ? `Escrow vuoto: payout già avvenuto on-chain (#${deal.id}). Tx: \`${deal.payoutTxSig}\``
      : `Escrow vuoto: fondi già trasferiti on-chain (#${deal.id}). Controlla Solscan sull'indirizzo escrow.`,

  walletWrongTurn: (deal: Deal, expected: "seller" | "buyer") => {
    const who =
      expected === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Ora tocca a ${who} impostare il wallet.`;
  },

  notReadyForDeposit:
    "L'indirizzo escrow appare dopo termini e wallet di seller e buyer.",

  termsOnlyInDm: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `I termini si compilano in *privato*. ${seller}: rispondi alle domande del bot in DM.`;
  },

  /** @deprecated Importo escrow fissato da Prezzo € (conversione automatica). */
  askEscrowAmount: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `${buyer} o ${seller}: invia l'importo escrow in *${deal.asset}* (es. \`0.05\`).`;
  },

  /** @deprecated */
  invalidEscrowAmount: (asset: string) =>
    `Importo escrow non valido. Invia un numero positivo in *${asset}* (es. \`0.05\`).`,

  dealActivated: depositPrompt,
  depositAddress: depositPrompt,

  depositDetected: (deal: Deal, balanceSol: string) =>
    `💰 Deal *#${deal.id}* fondato (*${balanceSol} SOL*).

Fee release: *5%* piattaforma (seller 95%). Rimborso: senza fee.

Entrambe le parti: /payseller oppure /refundbuyer (doppia conferma).`,

  /** Disclosure corta fee (card/status). */
  feeDisclosureShort:
    "Alla release: fee *5%* (seller riceve 95%). Nessuna fee sul rimborso.",

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

  payoutSuccess: (
    deal: Deal,
    kind: "release" | "refund",
    sig: string,
    sol: string,
    fees?: {
      platformFeeSol?: string;
      collaboratorFeeSol?: string;
      feeWallet?: string;
      collaboratorWallet?: string;
    },
  ) => {
    if (kind === "refund") {
      return `✅ *Rimborso completato* (#${deal.id}).\n*${sol} SOL* → buyer \`${deal.buyerWallet}\`\nTx: \`${sig}\``;
    }
    const lines = [
      `✅ *Rilascio completato* (#${deal.id}).`,
      `*${sol} SOL* → seller \`${deal.sellerWallet}\``,
    ];
    if (fees?.platformFeeSol && fees.platformFeeSol !== "0") {
      const dest = fees.feeWallet ? ` \`${fees.feeWallet}\`` : "";
      lines.push(`Fee piattaforma: *${fees.platformFeeSol} SOL*${dest}`);
    }
    if (fees?.collaboratorFeeSol && fees.collaboratorFeeSol !== "0") {
      const dest = fees.collaboratorWallet
        ? ` \`${fees.collaboratorWallet}\``
        : "";
      lines.push(`Fee collaboratore: *${fees.collaboratorFeeSol} SOL*${dest}`);
    }
    lines.push(`Tx: \`${sig}\``);
    return lines.join("\n");
  },

  payoutAlreadyDone: (deal: Deal) =>
    deal.payoutTxSig
      ? `Payout già completato (#${deal.id}). Tx: \`${deal.payoutTxSig}\``
      : `Payout già completato (#${deal.id}).`,

  payoutFailed: (deal: Deal, error: string) =>
    `❌ Payout non riuscito (#${deal.id}).\n${error}`,

  needWallet: (who: "buyer" | "seller") =>
    `Manca il wallet del *${who}*. Usa \`/wallet Indirizzo\`.`,

  adminForceRelease: (deal: Deal) =>
    `🔓 Admin: *pay_seller* su #${deal.id}…`,
  adminForceRefund: (deal: Deal) =>
    `↩️ Admin: *refund_buyer* su #${deal.id}…`,

  adminOnly: "Solo admin.",

  codiceUsage:
    "Uso (admin): `/codice <WALLET_SOL> <@user|userId> [CODICE]`\nEs: `/codice So111… @mario`\nEs: `/codice So111… 123456789 ESC-PROMO1`",

  codiceCreated: (code: string, wallet: string, who: string) =>
    `✅ Codice *${escMd(code)}*\nCollab: ${who}\nWallet: \`${wallet}\`\nL'utente: \`/invito ${code}\``,

  codiceListEmpty: "Nessun codice invito.",

  codiceListHeader: (n: number) => `Codici invito (*${n}*):`,

  feeSummaryHeader: (released: number, refunded: number) =>
    `Fee summary — released *${released}* · refunded *${refunded}*`,

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
  /** @deprecated /avvia consentito a buyer o seller. */
  notCreator: "Solo buyer o seller del deal possono usare /avvia.",
  notDealParty: "Solo *buyer* o *seller* del deal possono usare /avvia.",
  dealNotFound: "Deal non trovato.",
  noDeals: "Nessun deal. Usa /crea in privato.",
  onlyPrivate: "Usa questo comando in *chat privata* con il bot.",
  onlyGroup: "Usa questo comando nel *gruppo escrow*.",
  noDealInGroup:
    "Nessun deal collegato. In privato: /crea → poi qui /avvia (buyer o seller).",
  alreadyBound: "Questo gruppo è già collegato a un deal.",
  alreadyActivated: "Il deal in questo gruppo è già avviato.",
  /** /avvia ripetuto su deal già collegato: niente seconda card. */
  alreadyLinkedShort: (deal: Deal) =>
    `Deal *#${deal.id}* già collegato — \`${STATUS_LABELS[deal.status]}\`. Usa /stato.`,
  counterpartIsOpener: "Chi ha avviato il deal non conferma come controparte.",
  counterpartTaken: "La controparte è già assegnata.",
  tosSellerCannotAccept: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `I termini li accetta ${buyer}.`;
  },
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
    "Supporto Escrowita: nel gruppo del deal usa /dispute. L'operatore riceve notifica e può entrare.",

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
    "Bot nel gruppo. *Buyer* o *seller*: /avvia (servono i permessi admin).",

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
    `• Fee release: 5% (seller 95%; rimborso senza fee)`,
  ];
  if (deal.inviteCode) {
    lines.push(`• Invito: \`${deal.inviteCode}\``);
  }
  if (deal.payoutTxSig) {
    lines.push(`• Tx: \`${deal.payoutTxSig}\``);
  }
  return lines.join("\n");
}
