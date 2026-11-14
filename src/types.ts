export type DealStatus =
  | "pending_confirm"
  | "awaiting_deposit"
  | "funded"
  | "release_pending"
  | "refund_pending"
  | "released"
  | "refunded"
  | "disputed"
  | "cancelled";

export type Asset = "USDT";

export interface Deal {
  id: string;
  /** Chi crea il deal (tipicamente chi deposita / buyer) */
  creatorId: number;
  creatorUsername?: string;
  /** Controparte (tipicamente seller) */
  counterpartId?: number;
  counterpartUsername?: string;
  amount: string;
  asset: Asset;
  status: DealStatus;
  escrowAddress: string;
  /** User id che hanno già confermato il release */
  releaseVotes: number[];
  /** User id che hanno già confermato il refund */
  refundVotes: number[];
  createdAt: string;
  updatedAt: string;
}

export type CreateDealInput = {
  creatorId: number;
  creatorUsername?: string;
  counterpartId?: number;
  counterpartUsername?: string;
  amount: string;
  asset: Asset;
  escrowAddress: string;
};
