import { createHmac, timingSafeEqual } from "node:crypto";

export type WebAppUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type ValidatedWebAppInitData = {
  user: WebAppUser;
  authDate: number;
  raw: Record<string, string>;
};

/**
 * Valida `Telegram.WebApp.initData` (HMAC-SHA256, Bot API).
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateWebAppInitData(
  initData: string,
  botToken: string,
  opts?: { maxAgeSec?: number },
): ValidatedWebAppInitData | null {
  const raw = initData?.trim();
  if (!raw || !botToken) return null;

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const pairs: string[] = [];
  for (const key of [...params.keys()].sort()) {
    const value = params.get(key);
    if (value != null) pairs.push(`${key}=${value}`);
  }
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(hash, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const authDateRaw = params.get("auth_date");
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;

  const maxAge = opts?.maxAgeSec ?? 86_400;
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec < -60 || ageSec > maxAge) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: WebAppUser;
  try {
    const parsed = JSON.parse(userRaw) as WebAppUser;
    if (!parsed || typeof parsed.id !== "number") return null;
    user = parsed;
  } catch {
    return null;
  }

  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  out.hash = hash;

  return { user, authDate, raw: out };
}
