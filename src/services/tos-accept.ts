import type { Api } from "grammy";
import type { Deal } from "../types.js";
import type { DealStore } from "../store/deals.js";
import {
  amountConfirmed,
  isParty,
  isTermsProposer,
  parseAmount,
  termsReadyForConfirm,
  tosAccepted,
} from "./deal-logic.js";
import { convertPriceEurToAsset } from "./asset-crypto.js";
import { clearGroupTosMiniAppPin } from "./group-tos-pin.js";
import { postAskSellerWallet, refreshGroupSetupCard, refreshGroupTitle } from "./group-setup.js";
import {
  pinAcceptedTos,
  untrackPrompt,
} from "./prompt-cleanup.js";

export type AcceptTosFailReason =
  | "not_found"
  | "no_group"
  | "not_ready"
  | "already"
  | "not_party"
  | "proposer"
  | "missing_price"
  | "rate_unavailable";

export type AcceptTosResult =
  | { ok: true; deal: Deal }
  | { ok: false; reason: AcceptTosFailReason; deal?: Deal };

/**
 * Accetta i termini del deal (callback card gruppo `tosok`).
 * Controparte non-proponente; lock €→crypto; pin card; wallet seller.
 */
export async function acceptDealTerms(
  api: Api,
  store: DealStore,
  deal: Deal,
  userId: number,
  opts?: { pinMessageId?: number },
): Promise<AcceptTosResult> {
  let current = store.get(deal.id) ?? deal;

  if (!termsReadyForConfirm(current) || current.status !== "awaiting_tos_confirm") {
    return { ok: false, reason: "not_ready", deal: current };
  }
  if (tosAccepted(current)) {
    return { ok: false, reason: "already", deal: current };
  }
  if (!isParty(current, userId)) {
    return { ok: false, reason: "not_party", deal: current };
  }
  if (isTermsProposer(current, userId)) {
    return { ok: false, reason: "proposer", deal: current };
  }
  if (current.groupChatId == null) {
    return { ok: false, reason: "no_group", deal: current };
  }

  const maxDec = current.asset === "LTC" ? 8 : 9;
  let cryptoAmount = "";
  if (amountConfirmed(current) && parseAmount(current.amount, maxDec)) {
    cryptoAmount = current.amount;
  } else if (current.amount && parseAmount(current.amount, maxDec)) {
    cryptoAmount = current.amount;
  } else {
    if (!current.priceEur) {
      return { ok: false, reason: "missing_price", deal: current };
    }
    const converted = await convertPriceEurToAsset(
      current.asset,
      current.priceEur,
    );
    if (!converted) {
      return { ok: false, reason: "rate_unavailable", deal: current };
    }
    cryptoAmount = converted;
  }

  const tosMsgId =
    opts?.pinMessageId ??
    current.setupMessageId ??
    current.tosMiniAppMessageId;
  const now = new Date().toISOString();

  let updated =
    store.update(current.id, {
      tosAcceptedAt: now,
      amount: cryptoAmount,
      amountConfirmedAt: current.amountConfirmedAt ?? now,
      status: "awaiting_seller_wallet" as const,
      ...(tosMsgId != null
        ? {
            setupMessageId: current.setupMessageId ?? tosMsgId,
            tosAcceptedMessageId: current.setupMessageId ?? tosMsgId,
          }
        : {}),
    }) ?? current;

  if (tosMsgId != null) {
    updated = untrackPrompt(store, updated, tosMsgId);
  }

  updated = await clearGroupTosMiniAppPin(api, store, updated);

  const chatId = updated.groupChatId!;
  if (updated.setupMessageId != null) {
    await pinAcceptedTos(api, chatId, updated.setupMessageId);
  } else if (tosMsgId != null) {
    await pinAcceptedTos(api, chatId, tosMsgId);
  }

  updated = await refreshGroupTitle(api, store, updated);
  updated = await refreshGroupSetupCard(api, store, updated);
  await postAskSellerWallet(api, store, updated);
  return { ok: true, deal: store.get(updated.id) ?? updated };
}
