import type { Deal, DmTermsStep } from "../types.js";
import {
  amountConfirmed,
  bothPartiesPresent,
  commercialReleaseSplitEur,
  escMd,
  formatTosBullets,
  isTermsProposer,
  mentionPendingVoter,
  mentionTermsProposer,
  mentionUser,
  missingEssentialTerms,
  stripRepeatedLabel,
  termsReadyForConfirm,
  tosAccepted,
  type EssentialTermsField,
} from "../services/deal-logic.js";

const ESSENTIAL_LABELS: Record<EssentialTermsField, string> = {
  product: "Prodotto/servizio",
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
  release_pending: "rilascio in corso",
  refund_pending: "rimborso in corso",
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
    return `• Prezzo: *${deal.priceEur} €* · escrow SOL all'Accetto`;
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
  /** /start: iscrizione senza forzare @. */
  welcomeAskHandle:
    "Ciao, benvenuto su *Escrowita*.\n\nPer iscriverti invia `/start`.",

  askHandleAgain:
    "Imposta una *@* Telegram nel profilo, poi reinviami `/start`.",

  /** Display handle: @nome oppure «utente». */
  displayUser: (username?: string) =>
    username?.trim() ? `@${escMd(username.trim())}` : "utente",

  registeredOk: (username?: string) => {
    const who = username?.trim()
      ? `@${escMd(username.trim())}`
      : "utente";
    const softAt = username?.trim()
      ? ""
      : "\n\n_Imposta una @ Telegram per usare /crea._";
    return `✅ Iscrizione ok — ${who}.${softAt}

Escrow per *servizi digitali*, info e lavoro online.

/crea — nuovo deal
/miei — i tuoi deal`;
  },

  /** Stesso profilo (anche dopo delete bot). */
  welcomeBack: (username?: string) => {
    const who = username?.trim()
      ? `@${escMd(username.trim())}`
      : "utente";
    const softAt = username?.trim()
      ? ""
      : "\n\n_Imposta una @ Telegram per usare /crea._";
    return `Bentornato su *Escrowita* — ${who}.${softAt}

Escrow per *servizi digitali*, info e lavoro online.

/crea — nuovo deal
/miei — i tuoi deal`;
  },

  /** Canale vouch: già dentro. */
  vouchAlreadyMember: "✅ Sei già nel canale reviews.",

  /** Canale vouch: invita a entrare (hard gate). */
  needVouchJoin: (inviteLink: string) =>
    `Prima entra nel *canale reviews*:

${inviteLink}

Poi tocca *Ho entrato* o reinvia \`/start\`.`,

  vouchJoinedOk:
    "✅ Canale reviews ok. Ora puoi usare /crea.",

  vouchStillOut: (inviteLink: string) =>
    `Non ti vedo ancora nel canale.

${inviteLink}

Entra, poi *Ho entrato* o \`/start\`.`,

  askInviteOptional:
    "Codice invito? Invia il codice oppure tocca *Nessun codice*.",

  inviteRedeemOk: (code: string) =>
    `✅ Codice *${escMd(code)}* applicato.`,

  inviteRedeemAlready: (code: string) =>
    `Codice *${escMd(code)}* già attivo.`,

  inviteRedeemOther: "Hai già un codice invito.",

  inviteNotFound: "Codice non valido.",

  inviteUsage: "Uso: `/invito CODICE`.",

  /** Solo dopo tap «Nessun codice» / `/skip` esplicito mentre in attesa invito. */
  /** @deprecated Skip invito è silenzioso (cancella prompt, niente ack). */
  inviteSkipped: "Ok, nessun codice.",

  /** Gruppo leftover dopo wipe admin. */
  groupWipedNotice:
    "⚠️ Store deal azzerato dall'admin. Questo gruppo non è più collegato.\nIn privato: /crea → nuovo gruppo → /avvia.",

  handleMismatch: (expected?: string) =>
    expected
      ? `Usa *@${escMd(expected)}* (come nel profilo).`
      : "L'@ non corrisponde al profilo.",

  handleNeedTelegramUsername:
    "Imposta un username Telegram nel profilo, poi `/start`.",

  handleInvalid: "@ non valida. Es. `@nome`.",

  /** Soft gate @ per /crea (iscrizione ok anche senza). */
  needUsernameSoft:
    "Imposta una *@* Telegram nel profilo, poi riprova `/crea`.",

  /** Gate /start: solo opener (/crea, wizard termini opener, /invito). */
  needRegistration:
    "Per usare l'escrow apri una chat *privata* con il bot e invia `/start`.",

  /** @deprecated alias */
  needPrivateStart:
    "Per usare l'escrow apri una chat *privata* con il bot e invia `/start`.",

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

  /** Riepilogo vivente in DM proponente (elenco puntato). */
  dmTermsSummary: (deal: Deal) =>
    `📋 Deal *#${deal.id}* · *${deal.asset}*\n${formatTosBullets(deal)}`,

  dmTermsAsk: (step: DmTermsStep, _deal: Deal) => {
    if (step === "product") {
      return "1️⃣ Qual è il *Prodotto/servizio*?";
    }
    if (step === "price") {
      return "2️⃣ Qual è il *Prezzo* in euro? (es. `10` o `12,50`)";
    }
    return "3️⃣ Quali sono le *Condizioni*? (consegna, tempi, formato…)";
  },

  dmTermsComplete: (deal: Deal) =>
    `✅ Termini salvati per deal *#${deal.id}*.

Nel gruppo la controparte può *Accetta* o *Proponi i ToS*.`,

  dmTermsTooShort:
    "Troppo corto. Scrivi almeno un paio di caratteri chiari.",

  dmTermsInvalidPrice:
    "Prezzo non valido. Usa un importo in *euro* (es. `5`, `5€`, `12,50`).",

  dmTermsProposerBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: apri una chat *privata* con il bot (/start), poi rispondi alle 3 domande sui termini.`;
  },

  /** @deprecated alias → dmTermsProposerBlocked */
  dmTermsSellerBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: apri una chat *privata* con il bot (/start), poi rispondi alle 3 domande sui termini.`;
  },

  /** Post-crea (senza importo in DM): istruzioni gruppo manuale. */
  afterAmountInstructions: (deal: Deal) => {
    const termsNote = termsReadyForConfirm(deal)
      ? "\nTermini già compilati in privato."
      : "\nRispondi alle *3 domande* in privato (Prodotto/servizio, Prezzo €, Condizioni).";
    return `✅ Deal *#${deal.id}* pronto.

• Ruolo: *${deal.creatorRole}*
• Crypto: *${deal.asset}*${termsNote}

Ora (*entro 10 minuti*):
1. Crea un *gruppo privato*
2. Aggiungi questo bot al gruppo
3. Nel gruppo: /avvia

Poi invita l'altra parte.`;
  },

  /** Timer 10 min scaduto: bot non aggiunto / deal non collegato. */
  groupBindExpired: (deal: Deal) =>
    `⏱ Deal *#${deal.id}* annullato: setup gruppo non completato entro *10 minuti*.\nUsa /crea per ricominciare.`,

  groupReady: (deal: Deal, inviteLink: string, creatorInvited: boolean) =>
    `✅ Gruppo escrow pronto per deal *#${deal.id}*.

${creatorInvited ? "Ti ho già aggiunto al gruppo.\n" : ""}*Link invito* (max 2 — condividilo con l'altra parte):
${inviteLink}

Nel gruppo: /avvia (buyer o seller) → Accetta → wallet → deposito.
Verifica sempre l'indirizzo escrow nei messaggi del bot.`,

  groupCreateFailed: (deal: Deal, detail: string) =>
    `⚠️ Deal *#${deal.id}* pronto, ma la creazione automatica del gruppo non è riuscita.

\`${escMd(detail)}\`

Usa il percorso manuale: crea un gruppo privato → aggiungi il bot → /avvia.`,

  /**
   * Fallback corto se Mini App non disponibile (manca PUBLIC_BASE_URL).
   * Niente dump dei termini in chat.
   */
  tosFallback: (tosUrl?: string) =>
    tosUrl
      ? `📄 Termini Escrowita: apri la Mini App oppure ${tosUrl}`
      : "📄 Termini Escrowita: Mini App non ancora disponibile. Riprova tra poco.",

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
   * Buyer/Seller/Prodotto/Prezzo€/Condizioni; solo l'azione corrente sotto; Accetta/Proponi in button.
   * Post-deposito: riga *DEPOSITO CONFERMATO* sulla card pinnata.
   */
  groupSetupCard: (deal: Deal) => {
    const solHint =
      deal.amount && amountConfirmed(deal)
        ? ` · *${deal.amount} ${deal.asset}*`
        : "";
    const header = `🔒 Deal *#${deal.id}* · *${deal.asset}*${solHint}`;

    if (!bothPartiesPresent(deal) || deal.status === "awaiting_counterpart") {
      const missingRole = deal.creatorRole === "seller" ? "Buyer" : "Seller";
      return `${header}

${missingRole}: entra o scrivi un messaggio nel gruppo.`;
    }

    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");

    const bullets = [
      `• Buyer: ${buyer}`,
      `• Seller: ${seller}`,
      formatTosBullets(deal),
    ];

    const fundedLike =
      deal.status === "funded" ||
      deal.status === "release_pending" ||
      deal.status === "refund_pending" ||
      deal.status === "released" ||
      deal.status === "refunded" ||
      Boolean(deal.depositDetectedAt);
    if (fundedLike) {
      bullets.push("• *DEPOSITO CONFERMATO*");
      if (deal.sellerShippedAt) {
        bullets.push("• Consegna: segnata");
      }
    }

    let action: string | null = null;
    if (fundedLike) {
      action = null;
    } else if (tosAccepted(deal)) {
      // Wallet / deposito: istruzioni in messaggi dedicati — niente spoiler qui.
      action = null;
    } else if (
      deal.status === "awaiting_tos_confirm" &&
      termsReadyForConfirm(deal)
    ) {
      const other =
        deal.buyerId != null && isTermsProposer(deal, deal.buyerId)
          ? seller
          : buyer;
      action = `${other}: *Accetta* o *Proponi i ToS*.`;
    } else {
      const who = mentionTermsProposer(deal, "proponente");
      const missing = missingEssentialTerms(deal);
      if (deal.termsWizardInGroup) {
        if (missing.length > 0 && missing.length < 3) {
          action = `${who}: nel gruppo manca ancora ${formatMissingList(missing)}.`;
        } else {
          action = `${who}: rispondi alle *3 domande* nel gruppo.`;
        }
      } else if (missing.length > 0 && missing.length < 3) {
        action = `${who}: in privato manca ancora ${formatMissingList(missing)}.`;
      } else {
        action = `${who}: completa i termini in *chat privata* col bot.`;
      }
    }

    const body = bullets.join("\n");
    return action ? `${header}\n${body}\n\n${action}` : `${header}\n${body}`;
  },

  autoBindTooMany:
    "Troppi membri. Solo *buyer*, *seller* e il bot. Rimuovi gli altri, poi /avvia.",

  /**
   * Role-aware: opener seller → chiedi Buyer; opener buyer → chiedi Seller.
   */
  counterpartAsk: (deal: Pick<Deal, "creatorRole">) => {
    const missingRole = deal.creatorRole === "seller" ? "Buyer" : "Seller";
    return `${missingRole}: entra o scrivi un messaggio nel gruppo.`;
  },

  /**
   * /avvia ripetuto mentre manca la controparte (status dedicato).
   * Primo avvio: la living card basta — non stackare questo testo.
   */
  avviaAwaitingCounterpart: (deal: Pick<Deal, "id" | "creatorRole">) => {
    const missingRole = deal.creatorRole === "seller" ? "Buyer" : "Seller";
    return (
      `Deal *#${deal.id}* già avviato — in attesa della controparte.\n` +
      `${missingRole}: entra o scrivi un messaggio nel gruppo.`
    );
  },

  /** @deprecated Preferire counterpartAsk(deal). */
  autoBindNone: "Controparte: entra o scrivi un messaggio nel gruppo.",

  /** @deprecated Preferire counterpartAsk(deal). */
  autoBindNeedMessage: "Controparte: entra o scrivi un messaggio nel gruppo.",

  tosAccepted: (deal: Deal) =>
    deal.amount
      ? `✅ Termini accettati (#${deal.id}). Escrow: *${deal.amount} ${deal.asset}*.`
      : `✅ Termini accettati (#${deal.id}).`,

  tosLocked:
    "Termini già accettati: non si possono più modificare.",

  /** Conversione €→SOL fallita al momento dell'Accetto. */
  rateUnavailable:
    "Tasso €→SOL non disponibile al momento. Riprova tra poco con *Accetta*.",

  missingCommercialPrice:
    "Manca il prezzo in euro (termini DM). Completa *Prezzo* in privato.",

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

  /** Opener ancora in DM (non Proponi). */
  termsOnlyInDm: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: completa i termini in *chat privata* col bot.`;
  },

  /** Proponi i ToS: domanda già in gruppo — niente DM. */
  tosProposeStarted: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: rispondi alle *3 domande* nel gruppo.`;
  },

  /** @deprecated Proponi è in gruppo; tenuto per compat. */
  tosProposeDmBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: rispondi alle *3 domande* nel gruppo.`;
  },

  termsOnlyProposer: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `Solo ${who} può rispondere alle domande sui termini.`;
  },

  termsUseButtons:
    "Usa *Accetta* o *Proponi i ToS* sulla card.",

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

  /**
   * Post-deposito: tagga seller + prodotto/servizio (stato funded è sulla card pinnata).
   * Niente riga shouty «DEPOSITO…» qui — resta sulla pin.
   */
  shipAsk: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    const product = deal.tosProduct
      ? escMd(
          stripRepeatedLabel(
            stripRepeatedLabel(deal.tosProduct, "Prodotto/servizio"),
            "Prodotto",
          ),
        )
      : "—";
    return `${seller}, consegna:

• ${product}

Poi: *Consegnato*`;
  },

  /** @deprecated Preferire shipAsk; alias per watcher legacy. */
  depositDetected: (deal: Deal, _balanceSol: string) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    const product = deal.tosProduct
      ? escMd(
          stripRepeatedLabel(
            stripRepeatedLabel(deal.tosProduct, "Prodotto/servizio"),
            "Prodotto",
          ),
        )
      : "—";
    return `${seller}, consegna:

• ${product}

Poi: *Consegnato*`;
  },

  shipOnlySeller: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `Ora tocca a ${seller} segnare la consegna.`;
  },

  alreadyShipped: (deal: Deal) =>
    `Consegna già segnata (#${deal.id}).`,

  needShipFirst: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `Prima ${seller} deve segnare *Consegnato*.`;
  },

  /** Buyer dopo «consegnato». */
  buyerAfterShip: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `${buyer} — seller ha consegnato.

Scegli:`;
  },

  buyerOnlyPay: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Solo ${buyer} può avviare il pagamento.`;
  },

  sellerOnlyConfirm: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `Solo ${seller} può confermare il rilascio.`;
  },

  /** Solo la parte ancora in attesa può premere Confermo (release/refund). */
  onlyPendingConfirm: (deal: Deal, kind: "release" | "refund") => {
    const votes = kind === "release" ? deal.releaseVotes : deal.refundVotes;
    const who = mentionPendingVoter(deal, votes);
    return kind === "release"
      ? `Solo ${who} può confermare il rilascio.`
      : `Solo ${who} può confermare il rimborso.`;
  },

  /** Release buyer-first: seller/comando prima del voto buyer. */
  releaseNeedBuyerFirst: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Prima ${buyer} deve avviare il pagamento (*Paga seller*).`;
  },

  askSellerMoreInfo: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `${seller}: il buyer chiede altre info.`;
  },

  /** Disclosure corta fee (card/status). */
  feeDisclosureShort: (deal?: Deal) =>
    deal?.collaboratorWallet
      ? "Alla release: *2.5%* admin + *2.5%* collaboratore (seller 95%). Nessuna fee sul rimborso."
      : "Alla release: fee *5%* admin (seller riceve 95%). Nessuna fee sul rimborso.",

  /** Stessa parte riconferma 1/2. */
  alreadyVoted: (deal: Deal, kind: "release" | "refund") =>
    kind === "release"
      ? `Hai già confermato il rilascio (#${deal.id}). Aspetta l'altra parte.`
      : `Hai già confermato il rimborso (#${deal.id}). Aspetta l'altra parte.`,

  /** Tentativo verso opposto mentre una conferma è aperta. */
  confirmConflict: (deal: Deal, open: "release" | "refund") =>
    open === "release"
      ? `Conferma rilascio già aperta (#${deal.id}). Completatela o apri disputa.`
      : `Conferma rimborso già aperta (#${deal.id}). Completatela o apri disputa.`,

  depositCheckResult: (
    deal: Deal,
    balanceSol: string,
    funded: boolean,
  ) =>
    funded
      ? `✅ #${deal.id} fondato: *${balanceSol} SOL*.`
      : `⏳ #${deal.id}: *${balanceSol}* / *${deal.amount} SOL* (target lockato)\n\`${deal.escrowAddress}\``,

  markFundedAdmin: (deal: Deal) =>
    `💰 Admin: #${deal.id} forzato a *funded*.`,

  /**
   * Dual-confirm release 1/2: dopo voto buyer, tagga sempre il seller
   * (allineato al bottone Confermo).
   */
  releaseVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `${mentionUser(deal.sellerUsername, deal.sellerId, "seller")}: conferma rilascio (1/2).`
      : `🔓 Rilascio in corso (#${deal.id})…`,

  /** Dual-confirm refund 1/2: tagga chi deve ancora confermare. */
  refundVote: (deal: Deal, remaining: number) =>
    remaining > 0
      ? `${mentionPendingVoter(deal, deal.refundVotes)}: conferma *Rimborsa buyer* (1/2).`
      : `↩️ Rimborso in corso (#${deal.id})…`,

  /** Post 2/2 pay-seller: rating breve del bot (seller poi buyer). */
  reviewAsk: (deal: Deal, who: "seller" | "buyer") => {
    const tag =
      who === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `${tag}: come valuti *Escrowita*? Una riga basta.`;
  },

  reviewThanks: "Grazie mille per la tua valutazione.",

  reviewTooShort: "Troppo corto. Scrivi almeno un paio di caratteri.",

  reviewWrongParty: (deal: Deal, who: "seller" | "buyer") => {
    const tag =
      who === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Ora tocca a ${tag} lasciare la valutazione.`;
  },

  /**
   * Post canale vouch: card deal (Prodotto/Prezzo/Condizioni) + review
   * seller/buyer con @. Un solo messaggio quando entrambe le review ci sono.
   */
  vouchChannelPost: (deal: Deal) => {
    const bullets = formatTosBullets(deal);
    const sellerHandle = deal.sellerUsername
      ? `@${deal.sellerUsername}`
      : `id:${deal.sellerId ?? "?"}`;
    const buyerHandle = deal.buyerUsername
      ? `@${deal.buyerUsername}`
      : `id:${deal.buyerId ?? "?"}`;
    const lines: string[] = [bullets, ""];
    if (deal.sellerReviewText) {
      lines.push(
        `Seller ${sellerHandle}: ${escMd(deal.sellerReviewText)}`,
      );
    }
    if (deal.buyerReviewText) {
      lines.push(
        `Buyer ${buyerHandle}: ${escMd(deal.buyerReviewText)}`,
      );
    }
    lines.push("", `#${deal.id}`);
    return lines.join("\n");
  },

  logUsage:
    "Uso: `/log #250538a0` oppure `/log 250538a0` (solo admin, in privato).",

  logEmpty: (dealId: string) =>
    `Nessun log trattenuto per #${dealId}.`,

  logHeader: (dealId: string, n: number) =>
    `📋 Log deal #${dealId} (${n} voci)\n` +
    `_Messaggi parte + eventi chiave. Cap dimensione/età. Solo supporto dispute._`,

  /**
   * Rilascio: importi in €, @handles, fee «admin», senza tx link.
   * La signature resta dietro al bottone Hash.
   */
  payoutSuccess: (
    deal: Deal,
    kind: "release" | "refund",
    _sig: string,
    sol: string,
    _fees?: {
      platformFeeSol?: string;
      collaboratorFeeSol?: string;
      feeWallet?: string;
      collaboratorWallet?: string;
    },
  ) => {
    if (kind === "refund") {
      const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
      const split = commercialReleaseSplitEur(deal);
      if (split) {
        return `✅ *Rimborso completato* (#${deal.id}).\n• ${buyer}: *${split.totalEur} €*`;
      }
      return `✅ *Rimborso completato* (#${deal.id}).\n• ${buyer}: *${sol} SOL*`;
    }
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    const split = commercialReleaseSplitEur(deal);
    if (split) {
      const lines = [
        `✅ *Rilascio completato* (#${deal.id}).`,
        `• ${seller}: *${split.sellerEur} €*`,
        `• admin: *${split.adminEur} €*`,
      ];
      if (split.collaboratorEur && split.collaboratorEur !== "0") {
        lines.push(`• collaboratore: *${split.collaboratorEur} €*`);
      }
      return lines.join("\n");
    }
    // Fallback senza priceEur (deal legacy): niente wallet/pubkey in chiaro.
    return `✅ *Rilascio completato* (#${deal.id}).\n• ${seller}: *${sol} SOL*\n• admin: fee trattenuta`;
  },

  payoutHashReveal: (sig: string) => `\`${sig}\``,

  payoutHashMissing: "Nessuna signature disponibile.",

  payoutAlreadyDone: (deal: Deal) =>
    `Payout già completato (#${deal.id}).`,

  payoutFailed: (deal: Deal, error: string) =>
    `❌ Payout non riuscito (#${deal.id}).\n${error}`,

  needWallet: (who: "buyer" | "seller") =>
    `Manca il wallet del *${who}*. Usa \`/wallet Indirizzo\`.`,

  adminForceRelease: (deal: Deal) =>
    `🔓 Admin: rilascio su #${deal.id}…`,
  adminForceRefund: (deal: Deal) =>
    `↩️ Admin: rimborso su #${deal.id}…`,

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
    `✅ Deal *#${deal.id}* ricollegato a questo gruppo.\nStato: \`${deal.status}\` · saldo escrow ~*${balanceSol} SOL*\nSeller: \`${deal.sellerWallet}\`\nBuyer: \`${deal.buyerWallet}\`\nPoi: consegna → paga seller (o /admin_payout).`,

  adminPayoutUsage:
    "Uso (solo admin): `/admin_payout <dealId> seller|buyer`\nEs: `/admin_payout 82978c05 seller`",

  wrongStatus: (status: string) =>
    `Azione non disponibile in \`${status}\`.`,

  notParty: "Solo buyer/seller (o admin in disputa).",
  /** @deprecated /avvia consentito a buyer o seller. */
  notCreator: "Solo buyer o seller del deal possono usare /avvia.",
  notDealParty: "Solo *buyer* o *seller* del deal possono usare /avvia.",
  dealNotFound: "Deal non trovato.",
  /** @deprecated Preferire noConcludedDeals per /miei. */
  noDeals: "Nessun deal. Usa /crea in privato.",
  noConcludedDeals:
    "Nessun deal concluso. I deal aperti restano nel gruppo — usa /crea per uno nuovo.",
  onlyPrivate: "Usa questo comando in *chat privata* con il bot.",
  onlyGroup: "Usa questo comando nel *gruppo escrow*.",
  noDealInGroup:
    "Nessun deal collegato. In privato: /crea → poi qui /avvia (buyer o seller).",
  /** Questo chat ha già un deal (es. /ripristina su gruppo occupato). */
  alreadyBound: "Questo gruppo è già collegato a un deal.",
  /** Il deal scelto è già bound a un *altro* gruppo (multi-deal / link sbagliato). */
  alreadyBoundElsewhere: (deal: Deal) =>
    `Deal *#${deal.id}* è già collegato a un *altro* gruppo. Per un nuovo escrow: crea un gruppo nuovo, aggiungi il bot admin, poi /avvia.`,
  alreadyActivated: "Il deal in questo gruppo è già avviato.",
  /** /avvia ripetuto su deal già collegato: niente seconda card. */
  alreadyLinkedShort: (deal: Deal) =>
    `Deal *#${deal.id}* già collegato — \`${STATUS_LABELS[deal.status]}\`. Usa /stato.`,
  counterpartIsOpener: "Chi ha avviato il deal non conferma come controparte.",
  counterpartTaken: "La controparte è già assegnata.",

  adminWipeUsage:
    "Uso (solo admin, in privato):\n" +
    "• `/admin_wipe_deals` — anteprima (conteggio + escrows con saldo on-chain)\n" +
    "• `/admin_wipe_deals CONFERMA` — svuota `deals.json` + `deal-logs.json` se *nessun* escrow ha saldo\n" +
    "• `/admin_wipe_deals CONFERMA FORCE` — svuota *anche* con saldi on-chain (i fondi restano sull'indirizzo derivato; usa `recover:escrow` dopo)\n\n" +
    "⚠️ Non cancella i SOL on-chain. Non tocca `members.json` / `invites.json` / pin vouch.",
  adminWipePreview: (opts: {
    dealCount: number;
    logBuckets: number;
    fundedLines: string[];
    checkErrors: number;
  }) => {
    const head = `Anteprima wipe store: *${opts.dealCount}* deal · *${opts.logBuckets}* log.\nPath: \`DATA_DIR/deals.json\` + \`deal-logs.json\`.`;
    if (opts.fundedLines.length === 0 && opts.checkErrors === 0) {
      return (
        `${head}\n\nNessun saldo escrow rilevato.\n` +
        `Per procedere: \`/admin_wipe_deals CONFERMA\``
      );
    }
    const funded =
      opts.fundedLines.length > 0
        ? `\n\n⚠️ Escrow con saldo on-chain:\n${opts.fundedLines.join("\n")}`
        : "";
    const errs =
      opts.checkErrors > 0
        ? `\n\n⚠️ ${opts.checkErrors} check saldo falliti (RPC). Usa FORCE solo se sai cosa fai.`
        : "";
    return (
      `${head}${funded}${errs}\n\n` +
      `Con saldi: \`/admin_wipe_deals CONFERMA FORCE\` (i fondi restano on-chain).\n` +
      `Senza saldi: \`/admin_wipe_deals CONFERMA\`.`
    );
  },
  adminWipeNeedForce:
    "Ci sono escrow con saldo (o check falliti). Ripeti con `FORCE` oppure recupera prima i fondi (`npm run recover:escrow`).",
  adminWipeDone: (dealsRemoved: number, logsRemoved: number) =>
    `✅ Store svuotato: *${dealsRemoved}* deal, *${logsRemoved}* log. Members/invites/pin vouch intatti.`,
  /** Proponente non può accettare la propria proposta. */
  tosProposerCannotAccept:
    "Hai proposto tu i termini. Aspetta *Accetta* o *Proponi i ToS* dalla controparte.",

  /** @deprecated alias tono legacy — ora chiunque non-proponente Accetta */
  tosSellerCannotAccept: (_deal: Deal) =>
    "Hai proposto tu i termini. Aspetta *Accetta* o *Proponi i ToS* dalla controparte.",

  tosAlreadyAccepted: "Termini già accettati.",
  tosOnlyCounterpart: "Solo la controparte può *Accetta* o *Proponi i ToS*.",
  amountAlreadyConfirmed: "Importo già confermato.",

  /** Target SOL già lockato all'Accetto: no nuova FX / importo manuale. */
  amountLocked: (deal: Deal) =>
    `Importo escrow già fissato: *${deal.amount} ${deal.asset}* (#${deal.id}).`,
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
    `⚠️ Disputa aperta (#${deal.id}). Supporto avvisato: può entrare e risolvere.`,

  supportGroup:
    "Supporto Escrowita: usa *Disputa* nel gruppo. In disputa può entrare un operatore.",

  supportDm:
    "Supporto Escrowita: nel gruppo del deal apri *Disputa*. L'operatore riceve notifica e può entrare.",

  blockchainLink: (deal: Deal, url: string) =>
    `🔗 Tx deal *#${deal.id}*:\n${url}`,

  blockchainMissing:
    "Nessuna tx di payout ancora. Dopo il rilascio usa di nuovo /blockchain.",

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

In gruppo: comandi admin silenti di payout (potere admin in disputa).`,

  adminMissing:
    "Disputa registrata, ma nessun admin configurato (`ADMIN_TELEGRAM_ID` / `ADMIN_TELEGRAM_IDS`).",

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
    deal.collaboratorWallet
      ? `• Fee release: 2.5% admin + 2.5% collab (seller 95%; rimborso senza fee)`
      : `• Fee release: 5% admin (seller 95%; rimborso senza fee)`,
  ];
  if (deal.inviteCode) {
    lines.push(`• Invito: \`${deal.inviteCode}\``);
  }
  if (deal.sellerShippedAt && deal.status === "funded") {
    lines.push(`• Consegna: segnata`);
  }
  if (deal.payoutTxSig) {
    lines.push(`• Hash: disponibile (bottone)`);
  }
  return lines.join("\n");
}
