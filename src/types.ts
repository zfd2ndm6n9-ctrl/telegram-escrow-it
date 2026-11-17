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

/** Roadmap: SOL live → LTC / ETH. Niente USDT. */
export type Asset = "SOL" | "ETH" | "LTC";
export type PartyRole = "buyer" | "seller";

/** Step del wizard termini in DM (seller). */
export type DmTermsStep = "product" | "price" | "conditions";

export interface Deal {
  id: string;
  /** Chi ha avviato il wizard in privato */
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
  /** Termini del deal (elenco Prodotto / Prezzo € / Condizioni) */
  tosText?: string;
  /** Campo strutturato: Prodotto */
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
  /** Quando il buyer ha accettato la card termini */
  tosAcceptedAt?: string;
  /**
   * Importo escrow on-chain (stringa decimale nell'asset del deal).
   * Fissato dopo Accetto convertendo `priceEur` → SOL (niente seconda domanda prezzo).
   */
  amount: string;
  /** @deprecated Legacy dual-confirm importo; non usato nel flusso termini unificato */
  amountVotes?: number[];
  /**
   * Quando l'importo crypto è fissato (conversione €→SOL all'Accetto, o legacy).
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
  groupInviteLink?: string;
  adminInviteLink?: string;
  /** Voti per /pay_seller */
  releaseVotes: number[];
  /** Voti per /refund_buyer */
  refundVotes: number[];
  /** Lamports rilevati al funding (stringa per JSON) */
  depositLamports?: string;
  depositDetectedAt?: string;
  /**
   * Seller ha segnato «ho spedito» (post-deposito).
   * Stato on-chain resta `funded` finché non partono i voti di release.
   */
  sellerShippedAt?: string;
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
  /** Ultimo messaggio /stato del bot (sostituito al prossimo /stato). */
  lastStatusMessageId?: number;
  /**
   * Ultima risposta effimera da pulsanti deposito (indirizzo / verifica / disputa / …).
   * Sostituita al click successivo così non si accumulano risposte.
   */
  lastActionReplyId?: number;
  /**
   * DM seller: messaggio-riepilogo vivente (elenco Prodotto/Prezzo/Condizioni).
   * Edit in place; non cancellare durante il wizard.
   */
  dmTermsSummaryMessageId?: number;
  /**
   * DM seller: ultimo prompt di domanda (Prodotto/Prezzo/Condizioni).
   * Cancellato dopo ogni risposta.
   */
  dmTermsPromptMessageId?: number;
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
