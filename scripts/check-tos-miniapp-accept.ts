/**
 * Smoke: validateWebAppInitData HMAC + group pin / card keyboard shape.
 * Run: npx tsx scripts/check-tos-miniapp-accept.ts
 */
import { createHmac } from "node:crypto";
import {
  groupTosMiniAppKeyboard,
  groupTosMiniAppUrlKeyboard,
  tosConfirmKeyboard,
} from "../src/keyboards/menus.js";
import { validateWebAppInitData } from "../src/services/webapp-init-data.js";

function buildInitData(
  botToken: string,
  user: { id: number; first_name: string },
  authDate = Math.floor(Date.now() / 1000),
): string {
  const params = new URLSearchParams();
  params.set("auth_date", String(authDate));
  params.set("query_id", "AAEAAAE");
  params.set("user", JSON.stringify(user));
  const pairs: string[] = [];
  for (const key of [...params.keys()].sort()) {
    pairs.push(`${key}=${params.get(key)}`);
  }
  const dataCheckString = pairs.join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  params.set("hash", hash);
  return params.toString();
}

const token = "123456:ABC-DEF";
const init = buildInitData(token, { id: 42, first_name: "Ada" });
const ok = validateWebAppInitData(init, token);
if (!ok || ok.user.id !== 42) {
  throw new Error("validateWebAppInitData should accept signed payload");
}

const tampered = init.replace(/hash=[0-9a-f]+/, (m) =>
  m.endsWith("0") ? `${m.slice(0, -1)}1` : `${m.slice(0, -1)}0`,
);
const bad = validateWebAppInitData(tampered, token);
if (bad) throw new Error("tampered initData must fail");

const stale = buildInitData(
  token,
  { id: 7, first_name: "Old" },
  Math.floor(Date.now() / 1000) - 200_000,
);
if (validateWebAppInitData(stale, token, { maxAgeSec: 86_400 })) {
  throw new Error("stale auth_date must fail");
}

const kbCard = tosConfirmKeyboard("abc");
const cardJson = JSON.stringify(kbCard.inline_keyboard);
if (!cardJson.includes("tosok:abc")) {
  throw new Error("tosConfirmKeyboard must use tosok callback Accetta");
}
if (cardJson.includes("web_app")) {
  throw new Error("tosConfirmKeyboard must not use web_app Accetta");
}
if (!cardJson.includes("tospropose:abc")) {
  throw new Error("tosConfirmKeyboard must keep Proponi callback");
}

const pinUrl = "https://example.com/tos";
const kbPin = groupTosMiniAppKeyboard(pinUrl);
const pinJson = JSON.stringify(kbPin.inline_keyboard);
if (!pinJson.includes("web_app") || !pinJson.includes('"Leggi"')) {
  throw new Error("group pin must be web_app «Leggi»");
}
if (pinJson.includes("Accetta")) {
  throw new Error("group pin must not say Accetta");
}

const kbUrl = groupTosMiniAppUrlKeyboard(pinUrl);
const urlJson = JSON.stringify(kbUrl.inline_keyboard);
if (!urlJson.includes("url") || !urlJson.includes('"Leggi"')) {
  throw new Error("group pin url fallback must be «Leggi»");
}

console.log("check-tos-miniapp-accept: ok");
