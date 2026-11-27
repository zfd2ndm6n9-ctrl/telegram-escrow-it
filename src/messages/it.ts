import type { Deal, DmTermsStep } from "../types.js";
import {
  amountConfirmed,
  bothPartiesPresent,
  commercialReleaseSplitEur,
  escMd,
  formatEuroNumber,
  formatEuroPrice,
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
import { euroDisplayToNumber } from "../services/fx/sol-eur.js";

const ESSENTIAL_LABELS: Record<EssentialTermsField, string> = {
  product: "Prodotto/servizio",
  price: "Prezzo",
  conditions: "Condizioni",
  fee_payer: "Fee (Buyer/Seller)",
};

function formatMissingList(fields: EssentialTermsField[]): string {
  return fields.map((f) => `*${ESSENTIAL_LABELS[f]}*`).join(", ");
}

const STATUS_LABELS: Record<Deal["status"], string> = {
  awaiting_group: "In attesa gruppo",
  awaiting_bot_admin: "Permessi bot incompleti",
  awaiting_counterpart: "In attesa buyer/seller",
  awaiting_tos: "In attesa termini",
  awaiting_tos_confirm: "In attesa conferma termini",
  awaiting_amount: "In attesa importo",
  awaiting_amount_confirm: "In attesa conferma importo",
  awaiting_seller_wallet: "In attesa wallet seller",
  awaiting_buyer_wallet: "In attesa wallet buyer",
  awaiting_deposit: "In attesa deposito",
  funded: "Fondato",
  release_pending: "Rilascio in corso",
  refund_pending: "Rimborso in corso",
  released: "Rilasciato",
  refunded: "Rimborsato",
  disputed: "In disputa",
  cancelled: "Annullato",
};

function amountLine(deal: Deal): string {
  if (amountConfirmed(deal) || deal.amount) {
    return `• Importo: *${deal.amount} ${deal.asset}*`;
  }
  if (deal.priceEur) {
    return `• Prezzo: *${deal.priceEur} €*`;
  }
  return `• Crypto: *${deal.asset}*`;
}

/** Elenco Seller / Buyer su righe separate (card + stato). */
function partyBullets(deal: Deal): string[] {
  const seller = mentionUser(deal.sellerUsername, deal.sellerId, "—");
  const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "—");
  return [`• Seller: ${seller}`, `• Buyer: ${buyer}`];
}

/** Invito solo sulla card pinnata (mai ack in DM). */
function inviteBullet(deal: Deal): string | null {
  const code = deal.inviteCode?.trim();
  return code ? `• Invito: *${escMd(code)}*` : null;
}

/** Buyer + importo + indirizzo escrow su riga propria in `code` (Copia su mobile). */
function depositPrompt(deal: Deal): string {
  const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "Buyer");
  return `${buyer}, paga *${deal.amount} ${deal.asset}* a questo indirizzo:

\`${deal.escrowAddress}\`

⚠️ Controlla l'indirizzo *solo* nei messaggi di Escrowita in questo gruppo.`;
}

/** Fase deposito mostrata solo in Stato pre-deposito (non lo status store). */
export type DepositPhase = "in_attesa" | "rilevato" | "confermato";

const DEPOSIT_PHASE_LABELS: Record<DepositPhase, string> = {
  in_attesa: "In attesa",
  rilevato: "Rilevato",
  confermato: "Confermato",
};

/** Deriva In attesa / Rilevato / Confermato da saldo vs target. */
export function depositPhaseFromBalance(
  balanceSol: string,
  funded: boolean,
): DepositPhase {
  if (funded) return "confermato";
  const bal = Number(balanceSol);
  if (!Number.isFinite(bal) || bal <= 0) return "in_attesa";
  return "rilevato";
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
    // Menu = bottoni inline sotto (niente elenco /crea /miei nel testo).
    return `✅ Iscrizione completata — ${who}.${softAt}

🔒 Escrow sicuro per *servizi digitali*, info e lavoro online.`;
  },

  /** Stesso profilo (anche dopo delete bot). */
  welcomeBack: (username?: string) => {
    const who = username?.trim()
      ? `@${escMd(username.trim())}`
      : "utente";
    const softAt = username?.trim()
      ? ""
      : "\n\n_Imposta una @ Telegram per usare /crea._";
    // Menu = bottoni inline sotto (niente elenco /crea /miei nel testo).
    return `👋 Bentornato su *Escrowita* — ${who}.${softAt}

🔒 Escrow sicuro per *servizi digitali*, info e lavoro online.`;
  },

  /** Canale vouch: già dentro. */
  vouchAlreadyMember: "✅ Sei già nel canale reviews.",

  /** Canale vouch: invita a entrare (hard gate). */
  needVouchJoin: (inviteLink: string) =>
    `📣 Prima entra nel *canale reviews*:

${inviteLink}

Poi tocca *Sono entrato* o reinvia \`/start\`.`,

  vouchJoinedOk:
    "✅ Canale reviews ok. Tocca *Crea escrow* quando sei pronto.",

  vouchStillOut: (inviteLink: string) =>
    `👀 Non ti vedo ancora nel canale.

${inviteLink}

Entra, poi *Sono entrato* o \`/start\`.`,

  /** Prompt invito su /crea (dev `open`; soft-launch usa createGateInviteAsk). */
  askInviteOptional: "🔑 Codice invito? Invia il codice.",

  /**
   * @deprecated Apply invito è silenzioso in DM; il codice compare solo
   * sulla card pinnata del gruppo. Tenuto per smoke/compat.
   */
  inviteRedeemOk: (code: string) =>
    `✅ Codice *${escMd(code)}* applicato.`,

  /** @deprecated Stesso motivo di inviteRedeemOk — non inviare in DM. */
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

  /** Avviso subito dopo payout/refund riuscito (~1 min prima della delete). */
  groupClosingSoonNotice: "Il gruppo si chiude tra 1 minuto.",

  /** Fallback: prima di leaveChat se delete fallisce (gruppi manuali). */
  groupClosingNotice:
    "Deal concluso. Il bot lascia il gruppo. Potete archiviarlo o eliminarlo.",

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

  /**
   * Soft nudge in DM se non iscritto (mai «apri una chat privata»
   * quando sei già in privato).
   */
  needRegistration: "Prima `/start` qui.",

  /** @deprecated alias — stesso soft nudge DM. */
  needPrivateStart: "Prima `/start` qui.",

  /** /crea fuori dal privato: redirect corto + deep link. */
  creaInGroup: "Per creare un deal apri la chat *privata* col bot e usa `/crea`.",

  iscrittiCount: (n: number) => `Iscritti: *${n}*`,

  askRole: "👤 Che ruolo hai in questo deal?",
  assetNotConfigured: (asset: string) =>
    `Escrow *${asset}* non configurato sul server. Avvisa il supporto.`,
  askAmount:
    "Quanto vuoi mettere in escrow? Importo in *SOL* (es. `0.01`).\n⚠️ Mainnet reale: usa importi di test piccoli.",
  askWallet:
    "Invia `/wallet` seguito dal tuo indirizzo.",
  invalidAmount:
    "Importo non valido. Invia un numero positivo (es. `0.01`).",
  invalidWallet: (asset = "crypto") =>
    `Indirizzo *${asset}* non valido. Usa \`/wallet\` + indirizzo.`,
  solanaNotConfigured:
    "Escrow SOL non configurato sul server. Avvisa il supporto.",
  escrowNotConfigured:
    "Escrow on-chain non configurato sul server (manca SOLANA_PRIVATE_KEY). Avvisa il supporto.",
  cancelled: "Operazione annullata.",

  /** Prompt DM: dopo tap «Lascia un feedback». */
  feedbackAsk: "✍️ Scrivi il tuo feedback in un messaggio.",

  /** Dopo inoltro ok agli admin. */
  feedbackThanks: "✅ Grazie — feedback inviato al team.",

  /** Nessun ADMIN_TELEGRAM_ID(S): non possiamo inoltrare. */
  feedbackAdminMissing:
    "Grazie, ma al momento non posso inoltrare il feedback (admin non configurato).",

  /** Testo vuoto / solo spazi mentre in attesa feedback. */
  feedbackNeedText: "Scrivi un messaggio di testo, oppure ❌ Annulla.",

  /**
   * DM admin: header chiaro con @ e user id, poi corpo feedback.
   */
  feedbackAdminNotify: (
    username: string | undefined,
    userId: number,
    body: string,
  ) => {
    const handle = username?.trim()
      ? `@${escMd(username.trim())}`
      : "_senza @_";
    return `📩 *Feedback utente*

Da: ${handle}
Id: \`${userId}\`

${escMd(body)}`;
  },

  /**
   * @deprecated Fuori wizard: free text → delete silenzioso (niente reply).
   * Tenuto per smoke/compat.
   */
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
    if (step === "conditions") {
      return "3️⃣ Quali sono le *Condizioni*? (consegna, tempi, formato…)";
    }
    return (
      "4️⃣ Chi paga la fee del *5%*?\n" +
      "• *Buyer* → +5% sul deposito\n" +
      "• *Seller* → −5% al seller"
    );
  },

  /** Free text sullo step fee (servono i bottoni). */
  dmTermsFeeNeedButton: "Scegli *Buyer* o *Seller* con i bottoni.",

  dmTermsComplete: (deal: Deal) =>
    `✅ Termini salvati per deal *#${deal.id}*.

Nel gruppo l'altra parte può *Accetta* o *Proponi i ToS*.`,

  dmTermsTooShort:
    "Troppo corto. Scrivi almeno un paio di caratteri chiari.",

  dmTermsInvalidPrice:
    "Prezzo non valido. Usa un importo in *euro* (es. `5`, `5€`, `12,50`).",

  dmTermsProposerBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: apri una chat *privata* con il bot (/start), poi completa le domande sui termini.`;
  },

  /** @deprecated alias → dmTermsProposerBlocked */
  dmTermsSellerBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: apri una chat *privata* con il bot (/start), poi completa le domande sui termini.`;
  },

  /** Post-crea (senza importo in DM): istruzioni gruppo manuale. */
  afterAmountInstructions: (deal: Deal) => {
    const termsNote = termsReadyForConfirm(deal)
      ? "\nTermini già compilati in privato."
      : "\nRispondi alle domande in privato (Prodotto, Prezzo €, Condizioni, Fee).";
    return `✅ Deal *#${deal.id}* pronto.

• Ruolo: *${deal.creatorRole}*
• Crypto: *${deal.asset}*${termsNote}

⏱ Ora (*entro 10 minuti*):
1. Crea un *gruppo privato*
2. Aggiungi questo bot al gruppo
3. Nel gruppo: /avvia

Poi invita l'altra parte.`;
  },

  /** Timer 10 min scaduto: bot non aggiunto / deal non collegato. */
  groupBindExpired: (deal: Deal) =>
    `⏱ Deal *#${deal.id}* annullato: setup gruppo non completato entro *10 minuti*.\nUsa /crea per ricominciare.`,

  /** Effimero DM mentre l'helper crea il gruppo (cancellato al DM col link). */
  creatingGroup: "Sto creando il gruppo…",

  groupReady: (
    deal: Deal,
    links: { creatorLink: string; counterpartLink: string },
    _creatorInvited: boolean,
  ) => {
    void links.counterpartLink; // invito buyer/seller → messaggi nel gruppo
    void _creatorInvited; // mai «ti ho già aggiunto» — sempre entra + invita
    const missing =
      deal.creatorRole === "seller" ? "buyer" : "seller";
    // escMd: i link t.me/+… spesso contengono `_` → senza escape Telegram
    // rifiuta parse_mode Markdown e il DM invito non parte (regressione #84).
    return `✅ *Gruppo creato* · deal *#${escMd(deal.id)}*

Entra e invita il *${missing}*:
${escMd(links.creatorLink)}`;
  },

  /** Messaggio (B) gruppo helper: hint corto ruolo da invitare. */
  invitaMissingParty: (creatorRole: Deal["creatorRole"]) => {
    const missing = creatorRole === "seller" ? "buyer" : "seller";
    return `Invita il ${missing}`;
  },

  groupCreateFailed: (deal: Deal, detail: string) =>
    `⚠️ Deal *#${deal.id}* pronto, ma *non* sono riuscito a creare il gruppo (richiesto).

\`${escMd(detail)}\`

La Bot API di Telegram *non* può creare gruppi da sola: serve l'account helper MTProto.
Path di emergenza (meno sicuro — tu resti owner): crea un gruppo privato → aggiungi il bot admin → /avvia.`,

  /** Helper assente: avviso chiaro + istruzioni manuali degradata. */
  groupCreateHelperMissing: (deal: Deal) =>
    `⚠️ Deal *#${deal.id}*: creazione gruppo automatica non configurata.

Telegram non permette ai bot di creare gruppi (limite Bot API). Serve \`TELEGRAM_HELPER_SESSION\`.

Nel frattempo (emergenza): crea un *gruppo privato* → aggiungi il bot come admin → /avvia.
⚠️ In quel caso *tu* resti owner e puoi ancora kickare/cancellare — non è il path sicuro.`,

  /** Parte promossa admin su gruppo helper: demote + avviso corto. */
  partyAdminDemoted: (who: string) =>
    `${escMd(who)}: in questo gruppo escrow resti *membro* (niente admin).`,

  /**
   * Fallback corto se Mini App non disponibile (manca PUBLIC_BASE_URL).
   * Niente dump dei termini in chat.
   */
  tosFallback: (tosUrl?: string) =>
    tosUrl
      ? `📄 Termini Escrowita: apri la Mini App oppure ${tosUrl}`
      : "📄 Termini Escrowita: Mini App non ancora disponibile. Riprova tra poco.",

  /**
   * Pin nel gruppo dopo bind controparte.
   * Solo titolo bold; bottone «Leggi» apre Mini App (sola lettura).
   */
  groupTosMiniAppPin: "📄 *ESCROWITA TOS*",

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
      const missingRole = deal.creatorRole === "seller" ? "buyer" : "seller";
      // Helper-owned: due messaggi separati (link + «Invita il …») — non questa card.
      // Fallback se i due messaggi non sono ancora postati: link in testo.
      if (
        deal.groupCreatedVia === "helper" &&
        deal.counterpartInviteLink
      ) {
        return deal.counterpartInviteLink;
      }
      // Manuale (emergenza): role-aware, senza la parola «controparte».
      const label = missingRole === "buyer" ? "Buyer" : "Seller";
      return `${header}

${label}: entra o scrivi un messaggio nel gruppo.`;
    }

    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");

    const bullets = [
      ...partyBullets(deal),
      formatTosBullets(deal),
    ];
    const invite = inviteBullet(deal);
    if (invite) bullets.push(invite);

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
          action = `${who}: rispondi alle domande nel gruppo.`;
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
   * Role-aware: opener seller → invita buyer; opener buyer → invita seller.
   * Helper path: link (messaggio A); manual: entra/scrivi (mai «controparte»).
   */
  counterpartAsk: (
    deal: Pick<
      Deal,
      "creatorRole" | "groupCreatedVia" | "counterpartInviteLink"
    >,
  ) => {
    const missingRole = deal.creatorRole === "seller" ? "buyer" : "seller";
    if (deal.groupCreatedVia === "helper" && deal.counterpartInviteLink) {
      return deal.counterpartInviteLink;
    }
    const label = missingRole === "buyer" ? "Buyer" : "Seller";
    return `${label}: entra o scrivi un messaggio nel gruppo.`;
  },

  /**
   * Fallback status se i due messaggi invite non sono disponibili.
   * Con messaggi presenti: non inviare — niente stack.
   */
  avviaAwaitingCounterpart: (
    deal: Pick<
      Deal,
      "id" | "creatorRole" | "groupCreatedVia" | "counterpartInviteLink"
    >,
  ) => {
    const missingRole = deal.creatorRole === "seller" ? "buyer" : "seller";
    if (deal.groupCreatedVia === "helper" && deal.counterpartInviteLink) {
      return (
        `Deal *#${escMd(deal.id)}* — invita il *${missingRole}*:\n` +
        escMd(deal.counterpartInviteLink)
      );
    }
    const label = missingRole === "buyer" ? "Buyer" : "Seller";
    return (
      `Deal *#${escMd(deal.id)}* già avviato — in attesa.\n` +
      `${label}: entra o scrivi un messaggio nel gruppo.`
    );
  },

  /** @deprecated Preferire counterpartAsk(deal). */
  autoBindNone: "Buyer o seller: entra o scrivi un messaggio nel gruppo.",

  /** @deprecated Preferire counterpartAsk(deal). */
  autoBindNeedMessage: "Buyer o seller: entra o scrivi un messaggio nel gruppo.",

  tosAccepted: (deal: Deal) =>
    deal.amount
      ? `✅ Termini accettati (#${deal.id}). Importo: *${deal.amount} ${deal.asset}*.`
      : `✅ Termini accettati (#${deal.id}).`,

  tosLocked:
    "Termini già accettati: non si possono più modificare.",

  /** Conversione €→crypto fallita al momento dell'Accetto. */
  rateUnavailable: (asset = "crypto") =>
    `Tasso €→${asset} non disponibile al momento. Riprova tra poco con *Accetta*.`,

  missingCommercialPrice:
    "Manca il prezzo in euro (termini DM). Completa *Prezzo* in privato.",

  askSellerWallet: (deal: Deal) => {
    const who = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `👛 ${who}: invia \`/wallet\` seguito dal tuo indirizzo *${deal.asset}*.`;
  },

  askBuyerWallet: (deal: Deal) => {
    const who = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `👛 ${who}: invia \`/wallet\` seguito dal tuo indirizzo *${deal.asset}*.`;
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
    return `${who}: rispondi alle domande nel gruppo.`;
  },

  /** @deprecated Proponi è in gruppo; tenuto per compat. */
  tosProposeDmBlocked: (deal: Deal) => {
    const who = mentionTermsProposer(deal, "proponente");
    return `${who}: rispondi alle domande nel gruppo.`;
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

  /** Buyer dopo «consegnato»: parla al buyer della sua scelta. */
  buyerAfterShip: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `${buyer}: il seller ha consegnato.

Scegli: *Paga* o *Chiedi il rimborso*.`;
  },

  buyerOnlyPay: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Solo ${buyer} può avviare il pagamento.`;
  },

  /** Seller non avvia rimborso: solo buyer chiede; seller al massimo conferma 2/2. */
  buyerOnlyRefund: (deal: Deal) => {
    const buyer = mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Solo ${buyer} può chiedere il rimborso. Usa *Disputa* o *Altre info*.`;
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
    return `Prima ${buyer} deve avviare il pagamento (*Paga*).`;
  },

  askSellerMoreInfo: (deal: Deal) => {
    const seller = mentionUser(deal.sellerUsername, deal.sellerId, "seller");
    return `${seller}: il buyer chiede altre info.`;
  },

  /**
   * Altre info: parti + importo + fee.
   * In disputa: solo blocco (niente deposito/importo/prezzo).
   * Pre-deposito: niente riga Deposito / «In attesa deposito», niente Supporto.
   * Post-deposito: «Deposito confermato» + Supporto (Disputa).
   */
  altreInfoMenu: (deal: Deal, opts?: { depositLine?: string }) => {
    void opts?.depositLine;
    if (deal.status === "disputed") {
      return it.disputeInfoBlocked;
    }
    const postDeposit =
      deal.status === "funded" ||
      deal.status === "release_pending" ||
      deal.status === "refund_pending" ||
      deal.status === "released" ||
      deal.status === "refunded" ||
      Boolean(deal.depositDetectedAt);
    const seller = deal.sellerUsername
      ? `@${deal.sellerUsername}`
      : deal.sellerId
        ? String(deal.sellerId)
        : "—";
    const buyer = deal.buyerUsername
      ? `@${deal.buyerUsername}`
      : deal.buyerId
        ? String(deal.buyerId)
        : "—";
    const lines = [
      `*#${deal.id}*`,
      amountLine(deal),
      `• Seller: ${seller}`,
      `• Buyer: ${buyer}`,
    ];
    if (postDeposit) {
      lines.push("• Deposito confermato");
    }
    {
      const who =
        deal.feePayer === "buyer"
          ? "Buyer"
          : deal.feePayer === "seller"
            ? "Seller"
            : "Seller";
      lines.push(`• Fee: *5%* (a carico *${who}*)`, "• Rimborso: senza fee");
    }
    if (postDeposit) {
      lines.push("• Supporto: *Disputa*");
    }
    return lines.join("\n");
  },

  /**
   * Conferma same-@ prima di azione sensibile.
   * Bottoni: Sì + ← Indietro.
   */
  selfConfirmAsk: (
    deal: Deal,
    kind: "dispute_open" | "dispute_cancel" | "release" | "refund",
    userId: number,
  ) => {
    const who =
      deal.buyerId === userId
        ? mentionUser(deal.buyerUsername, deal.buyerId, "buyer")
        : deal.sellerId === userId
          ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
          : mentionUser(undefined, userId, "tu");
    switch (kind) {
      case "dispute_open":
        return `${who}: sei sicuro di aprire una disputa?`;
      case "dispute_cancel":
        return `${who}: sei sicuro di annullare la disputa?`;
      case "release":
        return `${who}: sei sicuro di pagare?`;
      case "refund":
        return `${who}: sei sicuro di chiedere il rimborso?`;
    }
  },

  selfConfirmWrongUser: (deal: Deal, userId: number) => {
    const who =
      deal.buyerId === userId
        ? mentionUser(deal.buyerUsername, deal.buyerId, "buyer")
        : deal.sellerId === userId
          ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
          : mentionUser(undefined, userId, "la parte");
    return `Solo ${who} può rispondere.`;
  },

  /** Azioni soldi bloccate in disputa — alert corto, niente wrongStatus spam. */
  frozenInDispute: "In disputa.",

  /**
   * Altre info / Stato in disputa: niente deposito/importo/prezzo.
   * Solo blocco chiaro fino al supporto.
   */
  disputeInfoBlocked:
    "*IN DISPUTA* — tutte le altre funzioni sono bloccate fino all'arrivo del supporto.",

  /** Gruppo compromesso: freeze azioni parti (bottoni / comandi in gruppo). */
  frozenGroupCompromised:
    "Gruppo non sicuro. Deal congelato — aspetta l'admin.",

  adminForceDmUsage: (kind: "release" | "refund") =>
    kind === "release"
      ? "Uso (admin, in privato): `/payseller <dealId>`\nEs: `/payseller 82978c05` (solo in disputa)."
      : "Uso (admin, in privato): `/refundbuyer <dealId>`\nEs: `/refundbuyer 82978c05` (solo in disputa).",

  adminForceDmUnknown: (dealId: string) =>
    `Deal #${dealId} non trovato nello store.`,

  disputeAlreadyOpen: "Disputa già aperta.",

  disputeCancelOnlyOpener: (deal: Deal) => {
    const openerId = deal.disputeOpenedBy;
    const who =
      openerId == null
        ? "chi l'ha aperta"
        : deal.buyerId === openerId
          ? mentionUser(deal.buyerUsername, deal.buyerId, "buyer")
          : deal.sellerId === openerId
            ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
            : mentionUser(undefined, openerId, "chi l'ha aperta");
    return `Solo ${who} può annullare la disputa.`;
  },

  disputeCancelled: (deal: Deal) =>
    `Disputa annullata (#${deal.id}).`,


  /** Disclosure corta fee (UI utente): sempre 5%, elenco puntato. */
  feeDisclosureShort: (deal?: Deal) => {
    const who =
      deal?.feePayer === "buyer"
        ? "Buyer"
        : deal?.feePayer === "seller"
          ? "Seller"
          : null;
    if (who) {
      return `• Fee: *5%* (a carico *${who}*)\n• Rimborso: senza fee`;
    }
    return "• Fee: *5%*\n• Rimborso: senza fee";
  },

  /** Stessa parte riconferma 1/2. */
  alreadyVoted: (deal: Deal, kind: "release" | "refund") =>
    kind === "release"
      ? `Hai già confermato il rilascio (#${deal.id}). Aspetta l'altra parte.`
      : `Hai già confermato il rimborso (#${deal.id}). Aspetta l'altra parte.`,

  /** Tentativo verso opposto mentre una conferma è aperta. */
  confirmConflict: (deal: Deal, open: "release" | "refund") =>
    open === "release"
      ? `Conferma rilascio già aperta (#${deal.id}). Completa, Annulla, o disputa.`
      : `Conferma rimborso già aperta (#${deal.id}). Completa, Annulla, o disputa.`,

  /** Abort dual-confirm 1/2 (Paga / Rimborsa): deal resta funded. */
  dualConfirmCancelled: (deal: Deal, kind: "release" | "refund") =>
    kind === "release"
      ? `Conferma rilascio annullata (#${deal.id}). Deal aperto.`
      : `Conferma rimborso annullata (#${deal.id}). Deal aperto.`,

  depositCheckResult: (
    deal: Deal,
    balanceStr: string,
    funded: boolean,
  ) =>
    funded
      ? `✅ #${deal.id} fondato: *${balanceStr} ${deal.asset}*.`
      : `⏳ #${deal.id}: *${balanceStr}* / *${deal.amount} ${deal.asset}* (target lockato)\n\`${deal.escrowAddress}\``,

  /**
   * Riga unica Stato deposito (pre-deposito):
   * In attesa / Rilevato / Confermato + progresso 0/X € (niente SOL / prezzo).
   */
  depositStatusBullets: (
    deal: Deal,
    balanceSol: string,
    _expectedSol: string,
    funded: boolean,
  ) => {
    void _expectedSol;
    const phase = depositPhaseFromBalance(balanceSol, funded);
    const eurRaw = deal.priceEur?.trim();
    const eur = eurRaw ? formatEuroPrice(eurRaw) : null;
    if (!eur) {
      return `• Deposito: *${DEPOSIT_PHASE_LABELS[phase]}*`;
    }
    if (phase === "confermato") {
      return `• Deposito: *Confermato* — *${escMd(eur)}* / *${escMd(eur)}*`;
    }
    if (phase === "in_attesa") {
      return `• Deposito: *In attesa* — *0* / *${escMd(eur)}*`;
    }
    // Parziale on-chain → stima € dal rapporto saldo/target (niente SOL in UI).
    const targetEur = eurRaw ? euroDisplayToNumber(eurRaw) : null;
    const targetSol = Number(deal.amount);
    const bal = Number(balanceSol);
    let progressLabel = "0";
    if (
      targetEur != null &&
      Number.isFinite(targetSol) &&
      targetSol > 0 &&
      Number.isFinite(bal) &&
      bal > 0
    ) {
      progressLabel = formatEuroPrice(
        formatEuroNumber((bal / targetSol) * targetEur),
      );
    }
    return `• Deposito: *Rilevato* — *${escMd(progressLabel)}* / *${escMd(eur)}*`;
  },

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
      ? `${mentionPendingVoter(deal, deal.refundVotes)}: conferma il *rimborso* (1/2).`
      : `↩️ Rimborso in corso (#${deal.id})…`,

  /** Post 2/2 pay-seller: rating breve del bot (seller poi buyer). */
  reviewAsk: (deal: Deal, who: "seller" | "buyer") => {
    const tag =
      who === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `${tag}: come valuti *Escrowita*? Una riga basta.`;
  },

  /** @deprecated Per-user grazie rimosso; usare reviewThanksBoth. */
  reviewThanks: "Grazie mille per la tua valutazione.",

  /** Un solo messaggio post-review, prima del flusso hash release. */
  reviewThanksBoth: "Grazie per la vostra valutazione.",

  reviewTooShort: "Troppo corto. Scrivi almeno un paio di caratteri.",

  reviewWrongParty: (deal: Deal, who: "seller" | "buyer") => {
    const tag =
      who === "seller"
        ? mentionUser(deal.sellerUsername, deal.sellerId, "seller")
        : mentionUser(deal.buyerUsername, deal.buyerId, "buyer");
    return `Ora tocca a ${tag} lasciare la valutazione.`;
  },

  /**
   * Post canale vouch: solo Prezzo + review seller/buyer (@).
   * Niente prodotto/condizioni (privacy). Un messaggio a gate completo.
   */
  vouchChannelPost: (deal: Deal) => {
    const price = deal.priceEur
      ? escMd(formatEuroPrice(deal.priceEur))
      : "—";
    const sellerHandle = deal.sellerUsername
      ? `@${deal.sellerUsername}`
      : `id:${deal.sellerId ?? "?"}`;
    const buyerHandle = deal.buyerUsername
      ? `@${deal.buyerUsername}`
      : `id:${deal.buyerId ?? "?"}`;
    const lines: string[] = [`• Prezzo: ${price}`, ""];
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
    `Log deal #${dealId} (${n} voci)\n` +
    `_Messaggi parte + eventi. Cap dimensione/età. Solo supporto dispute._`,

  /** Admin DM `/deal <id>`: fatti card + [del] + media silent-log. */
  dealAdminUsage:
    "Uso: `/deal 250538a0` oppure solo l’id (solo admin, in privato).\nMostra fatti + messaggi cancellati + media (metadata). Transcript completo: `/log`.",

  dealAdminUnknown: (dealId: string) =>
    `Deal #${dealId} non trovato nello store.`,

  dealAdminHeader: (dealId: string, evidenceN: number) =>
    `Deal #${dealId} — evidence (${evidenceN}: [del] + media)` +
    ` · transcript completo: \`/log ${dealId}\`` +
    `\n_Cerca il gruppo in Archiviati Telegram col codice #${dealId}._` +
    `\n_Media: solo metadata (tipo/chi/quando/caption) — Telegram non consegna i byte dopo delete._`,

  dealAdminFactsTitle: "— Fatti deal (card) —",

  /** @deprecated prefer dealAdminDeletedTitle */
  dealAdminChatTitle: "— Cancellati + media (silent-log) —",

  dealAdminDeletedTitle: "— Cancellati + media (silent-log) —",

  dealAdminNoDeleted: (dealId: string) =>
    `Nessun messaggio cancellato né media trattenuto per #${dealId}.\nChat viva: Archiviati Telegram (cerca #${dealId}). Transcript completo: \`/log ${dealId}\`.`,

  /** Gate /crea: soft-launch invite-only o staging admin-only. */
  createGateInviteRequired:
    "🔒 Soft-launch: serve un *codice invito* valido per creare un deal.\nInvia il codice (niente skip).",

  createGateAdminOnly:
    "🔒 Staging: solo admin può creare deal su questo bot.",

  createGateInviteAsk:
    "🔑 Soft-launch: invia il *codice invito* (obbligatorio).",

  /** Admin digita /payseller fuori disputa. */
  adminForceOnlyDisputed:
    "Force payout solo in *disputa*. Fuori: dual-confirm delle parti.",

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
      return `✅ *Rimborso completato* (#${deal.id}).\n• ${buyer}: *${sol} ${deal.asset}*`;
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
    return `✅ *Rilascio completato* (#${deal.id}).\n• ${seller}: *${sol} ${deal.asset}*\n• admin: fee trattenuta`;
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
    "Uso (admin): `/codice <WALLET_SOL> <@user|userId> [CODICE]`\nEs: `/codice So111… @mario`\nEs: `/codice So111… 123456789 ESC-PROMO1`\nOff → stesso nome riattiva. Disattiva: `/codiceoff CODICE` · On: `/codiceon CODICE`",

  codiceCreated: (code: string, wallet: string, who: string) =>
    `✅ Codice *${escMd(code)}*\nCollab: ${who}\nWallet: \`${wallet}\`\nL'utente: \`/invito ${code}\``,

  codiceReactivated: (code: string, wallet: string, who: string) =>
    `♻️ Codice *${escMd(code)}* riattivato.\nCollab: ${who}\nWallet: \`${wallet}\`\nL'utente: \`/invito ${code}\``,

  codiceOnUsage:
    "Uso (admin): `/codiceon <CODICE>`\nEs: `/codiceon CVVBYPASS`\n(riattiva senza cambiare wallet/collab; per aggiornare usa `/codice …`)",

  codiceOnOk: (code: string) =>
    `♻️ Codice *${escMd(code)}* riattivato (stesso wallet/collab).`,

  codiceOnAlready: (code: string) =>
    `Codice *${escMd(code)}* è già attivo.`,

  codiceOffUsage:
    "Uso (admin): `/codiceoff <CODICE>`\nEs: `/codiceoff ESC-A1B2C3`",

  codiceOffOk: (code: string) =>
    `🛑 Codice *${escMd(code)}* disattivato.\nNon vale su \`/crea\` e non compare in \`/codici\` (audit: \`/codici all\`).`,

  codiceOffAlready: (code: string) =>
    `Codice *${escMd(code)}* è già disattivato.`,

  codiceOffMissing: (code: string) =>
    `Codice *${escMd(code)}* non trovato.`,

  codiceListEmpty: "Nessun codice invito.",

  codiceListEmptyActive:
    "Nessun codice *attivo*. Audit (anche off): `/codici all`.",

  codiceListHeader: (n: number) => `Codici attivi (*${n}*):`,

  codiceListHeaderAll: (n: number) => `Codici (attivi + off) (*${n}*):`,

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
    status === "disputed"
      ? "In disputa."
      : `Azione non disponibile in \`${status}\`.`,


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
  counterpartIsOpener: "Chi ha avviato il deal non conferma come l'altra parte.",
  counterpartTaken: "Buyer e seller sono già assegnati.",

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
    "Hai proposto tu i termini. Aspetta *Accetta* o *Proponi i ToS* dall'altra parte.",

  /** @deprecated alias tono legacy — ora chiunque non-proponente Accetta */
  tosSellerCannotAccept: (_deal: Deal) =>
    "Hai proposto tu i termini. Aspetta *Accetta* o *Proponi i ToS* dall'altra parte.",

  tosAlreadyAccepted: "Termini già accettati.",
  tosOnlyCounterpart: "Solo l'altra parte può *Accetta* o *Proponi i ToS*.",
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
    `⚠️ Disputa aperta (#${deal.id}). Supporto può entrare e risolvere quando serve.`,

  supportGroup:
    "Supporto Escrowita: usa *Disputa* nel gruppo. In disputa può entrare un operatore.",

  supportDm:
    "Supporto Escrowita: nel gruppo del deal apri *Disputa*. Un operatore può entrare quando serve.",

  blockchainLink: (deal: Deal, url: string) =>
    `🔗 Tx deal *#${deal.id}*:\n${url}`,

  blockchainMissing:
    "Nessuna tx di payout ancora. Dopo il rilascio usa di nuovo /blockchain.",

  /** DM admin su disputa: solo #id + link gruppo (niente dump comandi/wallet). */
  disputeAdminNotify: (
    deal: Deal,
    _fromId: number,
    _fromUsername: string | undefined,
    link?: string,
  ) => {
    void _fromId;
    void _fromUsername;
    const lines = [`🚨 Disputa #${deal.id}`];
    if (link) lines.push(link);
    return lines.join("\n");
  },

  /**
   * DM admin fallita: fallback corto in gruppo — #id + link.
   */
  disputeAdminDmFailed: (
    deal: Deal,
    inviteLink?: string,
    _startLink?: string,
  ) => {
    void _startLink;
    const lines = [`Disputa #${deal.id} — avvisa l'admin in privato.`];
    if (inviteLink) lines.push(inviteLink);
    return lines.join("\n");
  },

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

/**
 * Bottone Stato: una sola riga — fase deposito + progresso €.
 * Niente SOL / Importo / Prezzo / seller / fee (quelli in Altre info).
 */
export function formatDepositStato(
  deal: Deal,
  opts?: { depositLine?: string; depositPhase?: DepositPhase },
): string {
  // In disputa: niente deposito/importo/prezzo — solo blocco chiaro.
  if (deal.status === "disputed") {
    return it.disputeInfoBlocked;
  }
  if (opts?.depositLine) {
    return opts.depositLine;
  }
  // Disputa solo post-deposito → disputed e stati chiusi contano come confermato.
  const phase: DepositPhase =
    opts?.depositPhase &&
    (deal.status === "awaiting_deposit" || opts.depositPhase === "confermato")
      ? opts.depositPhase
      : deal.status === "awaiting_deposit"
        ? "in_attesa"
        : "confermato";
  return it.depositStatusBullets(
    deal,
    phase === "in_attesa" ? "0" : deal.amount || "0",
    deal.amount || "0",
    phase === "confermato",
  );
}

/**
 * Elenco puntato completo (fallback / evidence-adjacent).
 * Preferire `formatDepositStato` per il bottone Stato e `altreInfoMenu` per Altre info.
 */
export function formatDealStatus(
  deal: Deal,
  opts?: { depositLine?: string; depositPhase?: DepositPhase },
): string {
  const seller = deal.sellerUsername
    ? `@${deal.sellerUsername}`
    : deal.sellerId
      ? String(deal.sellerId)
      : "—";
  const buyer = deal.buyerUsername
    ? `@${deal.buyerUsername}`
    : deal.buyerId
      ? String(deal.buyerId)
      : "—";
  // Dopo funded non riusare mai la fase «In attesa» (evita Stato stantio).
  const phase =
    opts?.depositPhase &&
    (deal.status === "awaiting_deposit" || opts.depositPhase === "confermato")
      ? opts.depositPhase
      : undefined;
  const statusText = phase
    ? DEPOSIT_PHASE_LABELS[phase]
    : STATUS_LABELS[deal.status];
  const lines = [
    `*#${deal.id}* — ${statusText}`,
    amountLine(deal),
    `• Seller: ${seller}`,
    `• Buyer: ${buyer}`,
  ];
  if (opts?.depositLine) {
    lines.push(opts.depositLine);
  }
  if (deal.sellerShippedAt && deal.status === "funded") {
    lines.push("• Consegna: segnata");
  }
  if (deal.status === "disputed") {
    lines.push("• Disputa aperta");
  }
  if (deal.groupCompromisedAt) {
    lines.push("• Gruppo: congelato");
  }
  if (deal.payoutTxSig) {
    lines.push("• Hash: disponibile (bottone)");
  }
  return lines.join("\n");
}

/**
 * Admin `/deal` evidence pack: stessi fatti della card pinnata + stato ToS.
 * Separato da `/stato` (che resta corto per le parti).
 */
export function formatDealEvidenceFacts(deal: Deal): string {
  const seller = deal.sellerUsername
    ? `@${deal.sellerUsername}`
    : deal.sellerId
      ? String(deal.sellerId)
      : "—";
  const buyer = deal.buyerUsername
    ? `@${deal.buyerUsername}`
    : deal.buyerId
      ? String(deal.buyerId)
      : "—";

  const lines: string[] = [
    `*#${deal.id}* — ${STATUS_LABELS[deal.status]}`,
    `• Seller: ${seller}`,
    `• Buyer: ${buyer}`,
    formatTosBullets(deal),
  ];
  if (deal.groupCompromisedAt) {
    const why = deal.groupCompromisedReason ?? "—";
    lines.push(`• Gruppo: *congelato* (${why})`);
  }

  if (amountConfirmed(deal) || deal.amount) {
    lines.push(`• Importo SOL: *${deal.amount} ${deal.asset}*`);
  } else {
    lines.push(`• Importo SOL: *—* (${deal.asset})`);
  }

  const invite = inviteBullet(deal);
  if (invite) lines.push(invite);

  if (tosAccepted(deal) && deal.tosAcceptedAt) {
    const when = deal.tosAcceptedAt.slice(0, 19).replace("T", " ");
    lines.push(`• ToS: *accettati* (${when} UTC)`);
  } else if (deal.tosText || termsReadyForConfirm(deal)) {
    lines.push("• ToS: *proposti, in attesa di accettazione*");
  } else if (
    deal.status === "awaiting_tos" ||
    deal.status === "awaiting_tos_confirm"
  ) {
    lines.push("• ToS: *in compilazione*");
  } else {
    lines.push("• ToS: *non impostati*");
  }

  if (deal.sellerShippedAt) {
    lines.push("• Consegna: segnata");
  }
  if (deal.status === "disputed") {
    lines.push("• Disputa aperta");
  }
  if (deal.payoutTxSig) {
    lines.push("• Hash: disponibile");
  }

  return lines.join("\n");
}
