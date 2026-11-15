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
  sellerId?: number;
  sellerUsername?: string;
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
  createdAt: string;
  updatedAt: string;
}

export type CreateDealInput = {
  creatorId: number;
  creatorUsername?: string;
  creatorRole: PartyRole;
  amount: string;
  asset: Asset;
  escrowAddress: string;
};
