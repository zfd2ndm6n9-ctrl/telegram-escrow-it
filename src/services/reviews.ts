import type { Api } from "grammy";
import { config } from "../config.js";
import { it } from "../messages/it.js";
import type { DealStore } from "../store/deals.js";
import type { Deal } from "../types.js";
import { MIN_TOS_FIELD } from "./deal-logic.js";
import {
  clearBotPrompts,
  deleteMessageSafe,
  sendTrackedPrompt,
} from "./prompt-cleanup.js";

function normalizeReviewText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function reviewsPending(deal: Deal): boolean {
  if (deal.payoutCompleted) return false;
  if (deal.status !== "release_pending") return false;
  if ((deal.releaseVotes?.length ?? 0) < 2) return false;
  if (deal.reviewPhase === "done") return false;
  if (deal.sellerReviewText && deal.buyerReviewText) return false;
  return true;
}

export function reviewsComplete(deal: Deal): boolean {
  return (
    deal.reviewPhase === "done" ||
    Boolean(deal.sellerReviewText && deal.buyerReviewText)
  );
}

/** Chi deve rispondere ora (se gate attivo). */
export function expectedReviewer(deal: Deal): "seller" | "buyer" | null {
  if (!reviewsPending(deal)) return null;
  if (!deal.sellerReviewText || deal.reviewPhase === "seller") return "seller";
  if (!deal.buyerReviewText || deal.reviewPhase === "buyer") return "buyer";
  return null;
}

async function clearReviewPrompt(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<Deal> {
  const chatId = deal.groupChatId;
  if (chatId != null && deal.reviewPromptMessageId != null) {
    await deleteMessageSafe(api, chatId, deal.reviewPromptMessageId);
  }
  return (
    store.update(deal.id, { reviewPromptMessageId: undefined }) ?? deal
  );
}

async function askReview(
  api: Api,
  store: DealStore,
  deal: Deal,
  who: "seller" | "buyer",
  opts?: { clearPrevious?: boolean },
): Promise<Deal> {
  let current = deal;
  if (opts?.clearPrevious !== false) {
    current = await clearBotPrompts(api, store, current);
  }
  current = await clearReviewPrompt(api, store, current);
  if (current.groupChatId == null) return current;

  const msg = await api.sendMessage(
    current.groupChatId,
    it.reviewAsk(current, who),
    { parse_mode: "Markdown" },
  );
  return (
    store.update(current.id, {
      reviewPhase: who,
      reviewPromptMessageId: msg.message_id,
      botPromptIds: [...(current.botPromptIds ?? []), msg.message_id],
    }) ?? current
  );
}

/**
 * Avvia o ripropone il gate review (seller → buyer) dopo 2/2 pay-seller.
 * Non usato su refund.
 */
export async function beginOrContinueReviews(
  api: Api,
  store: DealStore,
  deal: Deal,
): Promise<{ deal: Deal; readyForPayout: boolean }> {
  let current = store.get(deal.id) ?? deal;

  if (reviewsComplete(current)) {
    current =
      store.update(current.id, { reviewPhase: "done" }) ?? current;
    return { deal: current, readyForPayout: true };
  }

  if (!current.sellerReviewText) {
    current = await askReview(api, store, current, "seller");
    return { deal: current, readyForPayout: false };
  }

  if (!current.buyerReviewText) {
    current = await askReview(api, store, current, "buyer");
    return { deal: current, readyForPayout: false };
  }

  current = store.update(current.id, { reviewPhase: "done" }) ?? current;
  return { deal: current, readyForPayout: true };
}

export type ReviewAnswerResult =
  | { ok: true; deal: Deal; readyForPayout: boolean }
  | { ok: false; reason: "wrong_party" | "too_short" | "not_pending"; deal: Deal };

/**
 * Accetta la risposta review del party atteso; igiene Q+A; grazie; prossimo step.
 */
export async function acceptReviewAnswer(
  api: Api,
  store: DealStore,
  deal: Deal,
  fromId: number,
  rawText: string,
  userMessageId?: number,
): Promise<ReviewAnswerResult> {
  let current = store.get(deal.id) ?? deal;
  const who = expectedReviewer(current);
  if (!who) {
    return { ok: false, reason: "not_pending", deal: current };
  }

  const expectedId = who === "seller" ? current.sellerId : current.buyerId;
  if (expectedId == null || fromId !== expectedId) {
    return { ok: false, reason: "wrong_party", deal: current };
  }

  const text = normalizeReviewText(rawText);
  if (text.length < MIN_TOS_FIELD) {
    return { ok: false, reason: "too_short", deal: current };
  }

  const chatId = current.groupChatId;
  if (chatId != null) {
    if (userMessageId != null) {
      await deleteMessageSafe(api, chatId, userMessageId);
    }
    current = await clearReviewPrompt(api, store, current);
    current = await clearBotPrompts(api, store, current);
  }

  if (who === "seller") {
    current =
      store.update(current.id, {
        sellerReviewText: text,
        reviewPhase: "buyer",
      }) ?? current;
    await postReviewToVouch(api, current, "seller", text);
    // Grazie resta visibile; ask buyer senza cancellarlo subito.
    current = await sendTrackedPrompt(
      api,
      store,
      current,
      it.reviewThanks,
      { parse_mode: "Markdown" },
    );
    current = await askReview(api, store, current, "buyer", {
      clearPrevious: false,
    });
    return { ok: true, deal: current, readyForPayout: false };
  }

  current =
    store.update(current.id, {
      buyerReviewText: text,
      reviewPhase: "done",
    }) ?? current;
  await postReviewToVouch(api, current, "buyer", text);
  current = await sendTrackedPrompt(
    api,
    store,
    current,
    it.reviewThanks,
    { parse_mode: "Markdown" },
  );
  // Grazie resta fino al clear in runPayout / caller.
  return { ok: true, deal: current, readyForPayout: true };
}

/**
 * Best-effort: post review sul canale vouch.
 * Fallimenti non silenziosi: log ERROR con dettaglio Telegram
 * (tipico: bot non admin / manca permesso «Gestire i messaggi» / Post messages).
 * Invite canale invariata: https://t.me/+tww-HqO8htBiMzdk
 */
export async function postReviewToVouch(
  api: Api,
  deal: Deal,
  who: "seller" | "buyer",
  text: string,
): Promise<void> {
  const channelId = config.vouchChannelId;
  if (channelId == null) {
    console.error(
      `[vouch] VOUCH_CHANNEL_ID non impostato — skip post review deal=#${deal.id} who=${who}. ` +
        "Imposta env su Render e Manual Deploy. Bot admin canale con permesso «Gestire i messaggi» (Post).",
    );
    return;
  }
  try {
    await api.sendMessage(channelId, it.vouchReviewLine(deal, who, text));
    console.log(
      `[vouch] ok deal=#${deal.id} who=${who} channel=${channelId}`,
    );
  } catch (err) {
    const detail =
      err && typeof err === "object"
        ? {
            message: err instanceof Error ? err.message : String(err),
            error_code:
              "error_code" in err
                ? (err as { error_code?: unknown }).error_code
                : undefined,
            description:
              "description" in err
                ? (err as { description?: unknown }).description
                : undefined,
          }
        : { message: String(err) };
    console.error(
      `[vouch] FAIL post review deal=#${deal.id} who=${who} channel=${channelId}. ` +
        "Verifica: bot admin del canale + permesso «Gestire i messaggi» (can_post_messages). " +
        "Invite invariata https://t.me/+tww-HqO8htBiMzdk",
      detail,
    );
  }
}
