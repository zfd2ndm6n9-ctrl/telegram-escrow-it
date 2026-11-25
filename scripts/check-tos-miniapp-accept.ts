/**
 * Smoke: validateWebAppInitData HMAC + URL deal helper + keyboard shape.
 * Run: npx tsx scripts/check-tos-miniapp-accept.ts
 */
import { createHmac } from "node:crypto";
import { tosConfirmKeyboard } from "../src/keyboards/menus.js";
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

const kbMini = tosConfirmKeyboard("abc", "https://example.com/tos?deal=abc");
const miniJson = JSON.stringify(kbMini.inline_keyboard);
if (!miniJson.includes("web_app") || !miniJson.includes("Accetta")) {
  throw new Error("tosConfirmKeyboard with URL must use web_app Accetta");
}
if (!miniJson.includes("tospropose:abc")) {
  throw new Error("tosConfirmKeyboard must keep Proponi callback");
}

const kbCb = tosConfirmKeyboard("abc");
const cbJson = JSON.stringify(kbCb.inline_keyboard);
if (!cbJson.includes("tosok:abc")) {
  throw new Error("tosConfirmKeyboard without URL must use tosok callback");
}

console.log("check-tos-miniapp-accept: ok");
