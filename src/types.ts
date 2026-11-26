export type DealStatus =
  | "awaiting_group"
  | "awaiting_bot_admin"
  | "awaiting_counterpart"
  | "awaiting_tos"
  | "awaiting_tos_confirm"
  | "awaiting_amount"
  | "awaiting_amount_confirm"
  | "awaiting_seller_wallet"
  | "awaiting_buyer_wallet"
  | "awaiting_deposit"
  | "funded"
  | "release_pending"
  | "refund_pending"
  | "released"
  | "refunded"
  | "disputed"
  | "cancelled";

/** Perché il gruppo escrow non è più affidabile (freeze azioni in gruppo). */
export type GroupCompromiseReason =
  | "bot_kicked"
  | "group_gone"
  | "critical_msgs_deleted"
  | "admin_kicked";

/**
 * Conferma same-@ prima di azioni sensibili (disputa / paga / rimborsa / annulla).
 * Il voto controparte (1/2→2/2) resta separato.
 */
export type SelfConfirmKind =
  | "dispute_open"
  | "dispute_cancel"
  | "release"
  | "refund";

export type PendingSelfConfirm = {
  kind: SelfConfirmKind;
  userId: number;
};

/** SOL + LTC + ETH live. Niente USDT. */
export type Asset = "SOL" | "ETH" | "LTC";
export type PartyRole = "buyer" | "seller";

/** Step del wizard termini in DM (proponente corrente). */
export type DmTermsStep = "product" | "price" | "conditions";

export interface Deal {
  id: string;
  /** Chi ha avviato il wizard in privato (/crea opener) */
  creatorId: number;
  creatorUsername?: string;
  creatorRole: PartyRole;
  buyerId?: number;
  buyerUsername?: string;
  /** first_name Telegram visto all'assegnazione / ultimo check (anti-impersonation) */
  buyerDisplayName?: string;
  sellerId?: number;
  sellerUsername?: string;
  sellerDisplayName?: string;
  /** Indirizzo Solana del buyer (rimborso) */
  buyerWallet?: string;
  /** Indirizzo Solana del seller (rilascio) */
  sellerWallet?: string;
  /** Termini del deal (elenco Prodotto/servizio / Prezzo € / Condizioni) */
  tosText?: string;
  /** Campo strutturato: Prodotto/servizio */
  tosProduct?: string;
  /**
   * Prezzo commerciale in EUR (display, es. `5` o `12,50`).
   * Non è l'importo on-chain: quello resta in `amount`.
   */
  priceEur?: string;
  /**
   * Campo strutturato: Condizioni.
   * Nome storico `tosConditions` (prima etichettato «Tempi»); in UI è «Condizioni».
   */
  tosConditions?: string;
  /**
   * @deprecated Tempi rimosso; Condizioni vive in `tosConditions`.
   * Conservato solo per deal mid-flight legacy.
   */
  tosNotes?: string;
  /**
   * Chi ha compilato (o sta compilando) gli ultimi termini.
   * Controparte: Accetta o Proponi i ToS. Legacy senza campo → seller.
   */
  tosProposedBy?: number;
  /**
   * true = wizard termini attivo nel gruppo («Proponi i ToS» / nuovo round).
   * false/assente = wizard opener in DM.
   */
  termsWizardInGroup?: boolean;
  /** Quando la controparte ha accettato la card termini */
  tosAcceptedAt?: string;
  /**
   * Importo escrow on-chain (stringa decimale nell'asset del deal).
   * **SOL target lockato** dopo Accetto (conversione €→SOL una sola volta).
   * Watcher e Verifica deposito confrontano sempre questo valore — mai ricalcolo FX live.
   */
  amount: string;
  /** @deprecated Legacy dual-confirm importo; non usato nel flusso termini unificato */
  amountVotes?: number[];
  /**
   * Quando l'importo crypto è fissato (conversione €→SOL all'Accetto, o legacy).
   * Se presente con `amount`, il target SOL è immutabile (no underpay per oscillazioni FX).
   */
  amountConfirmedAt?: string;
  /**
   * Utenti umani già visti in questo gruppo (join / messaggi / /avvia).
   * Serve ad auto-assegnare la controparte (Bot API senza lista membri completa).
   */
  seenGroupUserIds?: number[];
  asset: Asset;
  status: DealStatus;
  /** Indirizzo deposito univoco (derivato) */
  escrowAddress: string;
  /** Chat id del gruppo escrow (negativo) */
  groupChatId?: number;
  /**
   * Quando `setChatPhoto` con branding Escrowita è riuscito per questo deal.
   * Idempotenza: non ri-caricare a ogni rename / /avvia ripetuto.
   */
  groupPhotoSetAt?: string;
  groupInviteLink?: string;
  /**
   * Secondo link invito (controparte) quando il gruppo è creato dall'helper.
   * `groupInviteLink` resta il link del creator (member_limit 1 ciascuno).
   */
  counterpartInviteLink?: string;
  /**
   * Messaggio (A) nel gruppo helper in attesa: solo il link invito controparte.
   * Cancellato insieme a `counterpartInviteHintMessageId` al join → ToS.
   */
  counterpartInviteLinkMessageId?: number;
  /**
   * Messaggio (B) separato: «Invita il buyer/seller».
   * Cancellato insieme a `counterpartInviteLinkMessageId` al join → ToS.
   */
  counterpartInviteHintMessageId?: number;
  /**
   * Chi ha creato il gruppo Telegram:
   * - `helper` = MTProto service account (parti non owner)
   * - `manual` = una parte ha creato il gruppo (owner umano = rischio kick/delete)
   */
  groupCreatedVia?: "helper" | "manual";
  /**
   * access_hash MTProto del megagroup (solo path helper).
   * Serve a `channels.DeleteChannel` dopo restart (StringSession senza entity cache).
   */
  groupAccessHash?: string;
  adminInviteLink?: string;
  /** Voti per /pay_seller */
  releaseVotes: number[];
  /** Voti per /refund_buyer */
  refundVotes: number[];
  /**
   * Chi ha aperto la disputa (solo costui può *Annulla disputa*).
   */
  disputeOpenedBy?: number;
  /**
   * Stato deal prima di `disputed` — ripristinato su annulla disputa.
   */
  statusBeforeDispute?: DealStatus;
  /**
   * Prompt «Sei sicuro…?» in attesa (Sì / ← Indietro), same-@.
   */
  pendingSelfConfirm?: PendingSelfConfirm;
  /** Lamports rilevati al funding (stringa per JSON) */
  depositLamports?: string;
  depositDetectedAt?: string;
  /**
   * Seller ha segnato «consegnato» (post-deposito).
   * Stato on-chain resta `funded` finché non partono i voti di release.
   * Nome campo storico `sellerShippedAt` (ex «ho spedito»).
   */
  sellerShippedAt?: string;
  /**
   * Dopo 2/2 pay-seller (non refund): review bot prima del payout on-chain.
   * `seller` → `buyer` → `done` (poi release).
   */
  reviewPhase?: "seller" | "buyer" | "done";
  /** Testo review seller (bot rating). */
  sellerReviewText?: string;
  /** Testo review buyer (bot rating). */
  buyerReviewText?: string;
  /** Prompt review corrente nel gruppo (cancellato con la risposta). */
  reviewPromptMessageId?: number;
  /** Signature payout on-chain */
  payoutTxSig?: string;
  /**
   * Codice invito del creator (attribuzione deal).
   * Alla RELEASE: 2.5% → collaboratorWallet se presente.
   */
  inviteCode?: string;
  collaboratorUserId?: number;
  /** Indirizzo SOL collaboratore (snapshot al create deal) */
  collaboratorWallet?: string;
  /** Contabilità fee release (lamports, stringhe JSON-safe) */
  platformFeeLamports?: string;
  collaboratorFeeLamports?: string;
  sellerPayoutLamports?: string;
  /** true dopo payout release/refund riuscito (idempotenza) */
  payoutCompleted?: boolean;
  /**
   * Dopo released/refunded: quando tentare delete del gruppo (~1 min).
   * Path helper: MTProto `channels.DeleteChannel` (owner). Soft-fail + log.
   * Path manuale: Bot API deleteChat se permesso, altrimenti leave.
   */
  groupDeleteAt?: string;
  /** ISO: cleanup gruppo (delete o leave) già tentato. */
  groupCleanupDoneAt?: string;
  /**
   * Message id dei prompt di stage del bot nel gruppo (wallet/deposit/…).
   * Cancellabili all’avanzamento; non sono evidenze utente.
   * Non include `setupMessageId` / `tosAcceptedMessageId` (card setup vivente).
   */
  botPromptIds?: number[];
  /**
   * Unico messaggio di setup nel gruppo (deal collegato → termini → Accetto).
   * Aggiornato in place con editMessageText; non cancellare in hygiene.
   */
  setupMessageId?: number;
  /**
   * Messaggio termini accettati (di solito = setupMessageId). Non cancellare in hygiene;
   * preferibilmente pinnato nel gruppo.
   */
  tosAcceptedMessageId?: number;
  /**
   * Teaser pinnato Mini App ToS (sola lettura, dopo bind).
   * Non cancellare in hygiene finché i termini deal non sono accettati.
   */
  tosMiniAppMessageId?: number;
  /** Ultimo messaggio /stato del bot (sostituito al prossimo /stato). */
  lastStatusMessageId?: number;
  /**
   * Ultima risposta effimera da pulsanti deposito (indirizzo / verifica / disputa / …).
   * Sostituita al click successivo così non si accumulano risposte.
   */
  lastActionReplyId?: number;
  /**
   * Ultimo errore di ruolo in gruppo («Solo @seller…», wallet turno sbagliato, …).
   * Cancellato quando la parte giusta agisce o il flusso avanza.
   */
  lastRoleErrorMessageId?: number;
  /**
   * DM proponente: messaggio-riepilogo vivente (elenco Prodotto/Prezzo/Condizioni).
   * Edit in place; non cancellare durante il wizard.
   */
  dmTermsSummaryMessageId?: number;
  /**
   * DM proponente: ultimo prompt di domanda (Prodotto/Prezzo/Condizioni).
   * Cancellato dopo ogni risposta.
   */
  dmTermsPromptMessageId?: number;
  /**
   * Gruppo: ultimo prompt domanda termini (Proponi i ToS).
   * Cancellato dopo ogni risposta + a fine wizard.
   */
  groupTermsPromptMessageId?: number;
  /**
   * ISO: gruppo compromesso (bot kick / gruppo cancellato / wipe card /
   * admin supporto kickato). Congela azioni parti in gruppo; soldi restano
   * chiudibili da DM admin (`/deal`, `/payseller`, `/refundbuyer`).
   */
  groupCompromisedAt?: string;
  /** Motivo del freeze gruppo (prima volta). */
  groupCompromisedReason?: GroupCompromiseReason;
  /**
   * Deadline ISO: da create deal (e refresh sulle istruzioni DM).
   * Scade se ancora `awaiting_group` senza bind, o `awaiting_bot_admin`
   * senza /avvia completato → status `cancelled`.
   */
  awaitingGroupExpiresAt?: string;
  /**
   * Message id delle istruzioni gruppo in DM del creator (cancellato a bind o scadenza).
   */
  dmGroupInstructionsMessageId?: number;
  /**
   * DM creator col link invito gruppo (post-create helper).
   * Cancellati quando la controparte entra (chat DM pulita).
   */
  dmCreatorInviteMessageIds?: number[];
  /**
   * Message id del notice «deal scaduto» in DM del creator
   * (cancellato al prossimo /crea).
   */
  dmGroupBindExpiredMessageId?: number;
  createdAt: string;
  updatedAt: string;
}

export type CreateDealInput = {
  creatorId: number;
  creatorUsername?: string;
  creatorDisplayName?: string;
  creatorRole: PartyRole;
  /** Opzionale: di solito impostato dopo dual-confirm in gruppo */
  amount?: string;
  asset: Asset;
  escrowAddress: string;
  /** Attribuzione invito del creator (snapshot) */
  inviteCode?: string;
  collaboratorUserId?: number;
  collaboratorWallet?: string;
};
