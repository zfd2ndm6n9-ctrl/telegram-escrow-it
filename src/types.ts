export type DealStatus =
  | "awaiting_group"
  | "awaiting_bot_admin"
  | "awaiting_counterpart"
  | "awaiting_tos"
  | "awaiting_tos_confirm"
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
  /** Termini del deal scritti dal creatore nel gruppo */
  tosText?: string;
  /** Quando la controparte ha accettato i ToS */
  tosAcceptedAt?: string;
  amount: string;
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
   * Message id dei prompt di stage del bot nel gruppo (ToS/wallet/deposit/…).
   * Cancellabili all’avanzamento; non sono evidenze utente.
   * Non include `tosAcceptedMessageId` (ToS accettati restano in chat).
   */
  botPromptIds?: number[];
  /**
   * Messaggio ToS accettati (testo termini + conferma). Non cancellare in hygiene;
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
  amount: string;
  asset: Asset;
  escrowAddress: string;
};
