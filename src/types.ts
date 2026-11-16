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
  /** Termini del deal (elenco Prodotto / Prezzo € / Tempi / Condizioni) */
  tosText?: string;
  /** Campo strutturato: Prodotto */
  tosProduct?: string;
  /**
   * Prezzo commerciale in EUR (display, es. `5` o `12,50`).
   * Non è l'importo on-chain: quello resta in `amount`.
   */
  priceEur?: string;
  /**
   * Campo strutturato: Tempi (consegna / scadenza).
   * Nome storico `tosConditions`; in UI è etichettato «Tempi».
   */
  tosConditions?: string;
  /** Campo opzionale: Condizioni / note extra (vuoto → — in card) */
  tosNotes?: string;
  /** Quando la controparte ha accettato la card termini */
  tosAcceptedAt?: string;
  /**
   * Importo escrow on-chain (stringa decimale nell'asset del deal).
   * Opzionale nei termini liberi; se manca, chiesto dopo Accetto in un messaggio.
   */
  amount: string;
  /** @deprecated Legacy dual-confirm importo; non usato nel flusso termini unificato */
  amountVotes?: number[];
  /**
   * Quando l'importo crypto è fissato (con Accetto se già nei termini,
   * oppure subito dopo la risposta all'ask post-Accetto).
   */
  amountConfirmedAt?: string;
  /**
   * Utenti umani già visti in questo gruppo (join / messaggi).
   * Serve ad auto-assegnare la controparte su /avvia (Bot API senza lista membri).
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
  /** Signature payout on-chain */
  payoutTxSig?: string;
  /**
   * Message id dei prompt di stage del bot nel gruppo (wallet/deposit/…).
   * Cancellabili all’avanzamento; non sono evidenze utente.
   * Non include `setupMessageId` / `tosAcceptedMessageId` (card setup vivente).
   */
  botPromptIds?: number[];
  /**
   * Unico messaggio di setup nel gruppo (deal collegato → ToS → importo).
   * Aggiornato in place con editMessageText; non cancellare in hygiene.
   */
  setupMessageId?: number;
  /**
   * Messaggio ToS accettati (di solito = setupMessageId). Non cancellare in hygiene;
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
};
