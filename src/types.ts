export type DealStatus =
  | "awaiting_group"
  | "awaiting_bot_admin"
  | "awaiting_counterpart"
  | "awaiting_deposit"
  | "funded"
  | "release_pending"
  | "refund_pending"
  | "released"
  | "refunded"
  | "disputed"
  | "cancelled";

export type Asset = "USDT";
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
  amount: string;
  asset: Asset;
  status: DealStatus;
  escrowAddress: string;
  /** Chat id del gruppo escrow (negativo) */
  groupChatId?: number;
  groupInviteLink?: string;
  adminInviteLink?: string;
  /** Voti per /pay_seller */
  releaseVotes: number[];
  /** Voti per /refund_buyer */
  refundVotes: number[];
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
