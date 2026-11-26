/**
 * Smoke: DM «Lascia un feedback» → admin notify + igiene Q/A.
 * npm exec tsx scripts/check-dm-feedback.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEEDBACK_CANCEL_CB,
  MAIN_MENU_FEEDBACK_CB,
  MAIN_MENU_FEEDBACK_LABEL,
  feedbackPromptKeyboard,
  mainMenuKeyboard,
} from "../src/keyboards/menus.js";
import { it } from "../src/messages/it.js";

const root = resolve(import.meta.dirname, "..");
const feedbackSrc = readFileSync(
  resolve(root, "src/handlers/feedback.ts"),
  "utf8",
);
const botSrc = readFileSync(resolve(root, "src/bot.ts"), "utf8");
const menusSrc = readFileSync(resolve(root, "src/keyboards/menus.ts"), "utf8");
const hygieneSrc = readFileSync(
  resolve(root, "src/services/dm-hygiene.ts"),
  "utf8",
);
const ctxSrc = readFileSync(resolve(root, "src/context.ts"), "utf8");
const creaSrc = readFileSync(
  resolve(root, "src/handlers/create-deal.ts"),
  "utf8",
);
const dealsSrc = readFileSync(resolve(root, "src/handlers/deals.ts"), "utf8");

assert.equal(MAIN_MENU_FEEDBACK_LABEL, "💬 Lascia un feedback");
assert.equal(MAIN_MENU_FEEDBACK_CB, "menu:feedback");
assert.equal(FEEDBACK_CANCEL_CB, "feedback_cancel");

const menu = mainMenuKeyboard();
assert.equal(menu.inline_keyboard?.[1]?.[0]?.text, MAIN_MENU_FEEDBACK_LABEL);
assert.equal(
  menu.inline_keyboard?.[1]?.[0]?.callback_data,
  MAIN_MENU_FEEDBACK_CB,
);

const askKb = feedbackPromptKeyboard();
assert.equal(askKb.inline_keyboard?.[0]?.[0]?.callback_data, FEEDBACK_CANCEL_CB);
assert.equal(askKb.inline_keyboard?.[0]?.[0]?.text, "❌ Annulla");

assert.match(menusSrc, /MAIN_MENU_FEEDBACK_LABEL/);
assert.match(menusSrc, /feedbackPromptKeyboard/);

assert.equal(it.feedbackAsk.includes("feedback"), true);
assert.equal(it.feedbackThanks.includes("Grazie"), true);
assert.match(it.feedbackAdminNotify("mario", 42, "ciao"), /@mario/);
assert.match(it.feedbackAdminNotify("mario", 42, "ciao"), /`42`/);
assert.match(it.feedbackAdminNotify("mario", 42, "ciao"), /ciao/);
assert.match(it.feedbackAdminNotify(undefined, 99, "x"), /senza @/);

assert.match(ctxSrc, /awaitingFeedback\?/);
assert.match(ctxSrc, /feedbackPromptMessageId\?/);
assert.match(ctxSrc, /feedbackEphemeralIds\?/);

assert.match(botSrc, /registerFeedbackHandlers/);
assert.match(botSrc, /awaitingFeedback/);

assert.match(feedbackSrc, /callbackQuery\(MAIN_MENU_FEEDBACK_CB/);
assert.match(feedbackSrc, /hears\(MAIN_MENU_FEEDBACK_LABEL/);
assert.match(feedbackSrc, /callbackQuery\(FEEDBACK_CANCEL_CB/);
assert.match(feedbackSrc, /adminTelegramIds/);
assert.match(feedbackSrc, /feedbackAdminNotify/);
assert.match(feedbackSrc, /clearFeedbackUi/);
assert.match(feedbackSrc, /replyEphemeralNotice/);
assert.match(feedbackSrc, /feedbackThanks/);
assert.match(feedbackSrc, /cancelMidCreaBeforeGroupBind/);

assert.match(hygieneSrc, /export async function clearFeedbackUi/);
assert.match(hygieneSrc, /cancelLeftoverCreaForNewFlow[\s\S]*clearFeedbackUi/);

assert.match(creaSrc, /MAIN_MENU_FEEDBACK_LABEL/);
assert.match(creaSrc, /awaitingFeedback[\s\S]*await next\(\)/);

assert.match(dealsSrc, /clearFeedbackUi/);

console.log("check-dm-feedback: OK");
