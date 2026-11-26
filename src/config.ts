import "dotenv/config";
import { resolveDataDir } from "./data-dir.js";

export { resolveDataDir } from "./data-dir.js";
export type { ResolveDataDirOptions } from "./data-dir.js";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}. Copia .env.example in .env oppure esporta la variabile.`,
    );
  }
  return value;
}

/** `ADMIN_TELEGRAM_ID` + `ADMIN_TELEGRAM_IDS` (csv / spazi / `;`). Dedup. */
function parseAdminTelegramIds(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(/[,;\s]+/)) {
      const id = part.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  };
  add(process.env.ADMIN_TELEGRAM_ID);
  add(process.env.ADMIN_TELEGRAM_IDS);
  return out;
}

const adminTelegramIds = parseAdminTelegramIds();

/**
 * Ambiente operativo: influenza il default di `CREATE_GATE`.
 * - `staging` → create solo admin (backtest)
 * - `production` → soft-launch invite-only
 * - `development` / unset → open (invite opzionale, comportamento storico)
 */
export type AppEnv = "staging" | "production" | "development";

/** Gate su `/crea`: chi può aprire un deal. */
export type CreateGate = "open" | "invite" | "admin";

function parseAppEnv(): AppEnv {
  const raw = (process.env.APP_ENV?.trim() || "").toLowerCase();
  if (raw === "staging" || raw === "stage") return "staging";
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "development" || raw === "dev") return "development";
  // Compat: NODE_ENV=production senza APP_ENV → production soft-launch.
  if ((process.env.NODE_ENV?.trim() || "").toLowerCase() === "production") {
    return "production";
  }
  return "development";
}

function parseCreateGate(appEnv: AppEnv): CreateGate {
  const raw = (process.env.CREATE_GATE?.trim() || "").toLowerCase();
  let gate: CreateGate;
  if (raw === "open" || raw === "invite" || raw === "admin") {
    gate = raw;
  } else if (appEnv === "staging") {
    gate = "admin";
  } else if (appEnv === "production") {
    gate = "invite";
  } else {
    gate = "open";
  }

  // Soft-launch fail-safe: never leave /crea open on a production Node process
  // (forgotten CREATE_GATE=open, or APP_ENV missing while NODE_ENV=production).
  const nodeProd =
    (process.env.NODE_ENV?.trim() || "").toLowerCase() === "production";
  if (gate === "open" && (appEnv === "production" || nodeProd)) {
    console.warn(
      `CREATE_GATE=open ignorato (APP_ENV=${appEnv}, NODE_ENV=${process.env.NODE_ENV ?? ""}): soft-launch → invite`,
    );
    return "invite";
  }
  return gate;
}

const appEnv = parseAppEnv();
const createGate = parseCreateGate(appEnv);

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  /** `staging` | `production` | `development`. Vedi `CREATE_GATE`. */
  appEnv,
  /**
   * Gate `/crea`:
   * - `open` — invite opzionale (**solo** development locale)
   * - `invite` — codice obbligatorio (soft-launch production)
   * - `admin` — solo ADMIN_TELEGRAM_ID(S) (staging backtest)
   * Override: `CREATE_GATE=open|invite|admin`.
   * Fail-safe: con `APP_ENV=production` o `NODE_ENV=production`,
   * `CREATE_GATE=open` viene ignorato → `invite`.
   */
  createGate,
  /**
   * Admin / supporto (dispute notify, `/log`, force payout, `/iscritti`, …).
   * Preferire `ADMIN_TELEGRAM_IDS` (lista). `ADMIN_TELEGRAM_ID` resta supportato.
   */
  adminTelegramIds,
  /** Primo admin (compat notify + messaggi che citano un solo id). */
  adminTelegramId: adminTelegramIds[0],
  /**
   * Host pubblico HTTPS del Web Service (senza trailing slash).
   * Usato per la Mini App ToS: `${publicBaseUrl}/tos`.
   * Env: `PUBLIC_BASE_URL`, altrimenti `RENDER_EXTERNAL_URL` (auto su Render).
   */
  publicBaseUrl: resolvePublicBaseUrl(),
  /**
   * URL Mini App Termini (`web_app` su «Leggi i Termini»).
   * Priorità: `TOS_URL` esplicito → `${PUBLIC_BASE_URL|/RENDER_EXTERNAL_URL}/tos`.
   * Se assente: bottone callback + messaggio corto (niente dump in chat).
   */
  tosWebAppUrl: resolveTosWebAppUrl(),
  /**
   * Secret Solana MAINNET (base58 o JSON array). Solo env / Render — mai in repo.
   * Opzionale a boot: senza chiave i deal on-chain non partono.
   * È anche la hot wallet fee-payer (fee di rete) e destinazione fee 5% di default.
   */
  solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY?.trim() || undefined,
  /**
   * Destinazione fee piattaforma (5% o 2.5% con invito).
   * Se assente → stessa pubkey della master (`SOLANA_PRIVATE_KEY`).
   * Solo pubkey base58 — niente secret.
   */
  feeWalletPubkey: process.env.FEE_WALLET_PUBKEY?.trim() || undefined,
  /**
   * RPC Solana. Default: pubblico mainnet-beta (rate-limitati).
   * Consigliato in prod: Helius / QuickNode / Alchemy.
   */
  solanaRpcUrl:
    process.env.SOLANA_RPC_URL?.trim() ||
    "https://api.mainnet-beta.solana.com",
  /** Intervallo poll depositi (ms) */
  solanaWatchIntervalMs: Number(
    process.env.SOLANA_WATCH_INTERVAL_MS?.trim() || "20000",
  ),
  /**
   * Secret Litecoin MAINNET (WIF o hex 32 byte). Solo env / Render — mai in repo.
   * Opzionale a boot: senza chiave i deal LTC non partono.
   * Master = derive escrow per-deal (HMAC) + default destinazione fee se
   * `FEE_WALLET_LTC` assente. Fee di rete UTXO escono dagli input escrow.
   */
  ltcPrivateKey: process.env.LTC_PRIVATE_KEY?.trim() || undefined,
  /**
   * Destinazione fee piattaforma LTC (5% o 2.5% con invito + wallet LTC collab).
   * Se assente → indirizzo della master (`LTC_PRIVATE_KEY`).
   * Solo address mainnet (`ltc1…` / `L…`) — niente secret.
   */
  ltcFeeAddress:
    process.env.FEE_WALLET_LTC?.trim() ||
    process.env.LTC_FEE_ADDRESS?.trim() ||
    undefined,
  /**
   * API Litecoin (saldo / UTXO / broadcast).
   * Default: https://litecoinspace.org/api (stile mempool).
   * Alternativa: https://api.blockcypher.com/v1/ltc/main (+ `LTC_API_TOKEN`).
   */
  ltcApiUrl:
    process.env.LTC_API_URL?.trim() || "https://litecoinspace.org/api",
  /** Token opzionale (BlockCypher `token=` query). */
  ltcApiToken: process.env.LTC_API_TOKEN?.trim() || undefined,
  /** Intervallo poll depositi LTC (ms). Default = stesso di SOL. */
  ltcWatchIntervalMs: Number(
    process.env.LTC_WATCH_INTERVAL_MS?.trim() ||
      process.env.SOLANA_WATCH_INTERVAL_MS?.trim() ||
      "20000",
  ),
  defaultAsset: "SOL" as const,
  /**
   * Cartella persistente per deals.json, members.json, invites.json, …
   * Su Render: Persistent Disk + path **assoluto** `DATA_DIR=/var/data`
   * (non `var/data`: relativo → `/app/var/data` e disco vuoto).
   * Default locale: `data` (gitignored), risolto ad assoluto.
   */
  dataDir: resolveDataDir(),
  /** Impostato a runtime dopo getMe() */
  botUsername: undefined as string | undefined,
  /**
   * Account helper MTProto per creare i gruppi escrow (la Bot API non può).
   * Opzionale: il path felice è gruppo manuale + /avvia.
   * api_id / api_hash da https://my.telegram.org — session string da `npm run helper:login`.
   */
  telegramApiId: Number(process.env.TELEGRAM_API_ID?.trim() || "0") || undefined,
  telegramApiHash: process.env.TELEGRAM_API_HASH?.trim() || undefined,
  telegramHelperSession: process.env.TELEGRAM_HELPER_SESSION?.trim() || undefined,
  /**
   * Preferisci creazione gruppo via helper MTProto dopo /crea.
   * Default **on** (Bot API non può creare gruppi; serve helper).
   * Imposta `0`/`false`/`no` solo per forzare il path manuale legacy.
   */
  telegramBotCreatesGroups: !["0", "false", "no"].includes(
    (process.env.TELEGRAM_BOT_CREATES_GROUPS?.trim() || "1").toLowerCase(),
  ),
  /**
   * DM automatici agli admin su ogni disputa aperta (deal #id chiaro).
   * Default **on** — l’operatore cerca il gruppo in Archiviati col codice deal.
   * Imposta `0`/`false`/`no` per silenziare (critici kick/delete restano on).
   */
  disputeAdminNotify: !["0", "false", "no"].includes(
    (process.env.DISPUTE_ADMIN_NOTIFY?.trim() || "1").toLowerCase(),
  ),
  /**
   * Canale pubblico aggiornamenti (CoinXpert-style «N iscritti»).
   * Il bot deve essere admin del canale.
   * Accetta id numerico (-100…) o @username del canale.
   */
  updatesChannelId: parseChannelId(process.env.UPDATES_CHANNEL_ID),
  /**
   * Opzionale: message_id di un messaggio vivente (idealmente fissato) da editare
   * con il conteggio. Se assente → aggiorna la description del canale.
   */
  updatesChannelMessageId: parsePositiveInt(
    process.env.UPDATES_CHANNEL_MESSAGE_ID,
  ),
  /**
   * Canale vouch / recensioni post-release.
   * Invite tipica: https://t.me/+tww-HqO8htBiMzdk (override con VOUCH_INVITE_LINK).
   * Preferire id numerico (-100…). Bot admin con permesso «Gestire i messaggi»
   * (Post messages / can_post_messages) — sufficiente; non servono altri flag.
   * Come ottenere l'id: aggiungi il bot admin → inoltra un msg del canale
   * a @userinfobot / @getidsbot, oppure leggi il chat id nei log Telegram.
   * Gate: /crea e uso deal richiedono getChatMember = membro del canale.
   */
  vouchChannelId: parseChannelId(process.env.VOUCH_CHANNEL_ID),
  /**
   * Link invito canale vouch (mostrato a /start).
   * Default pubblico; su Render puoi sovrascrivere con VOUCH_INVITE_LINK.
   */
  vouchInviteLink:
    process.env.VOUCH_INVITE_LINK?.trim() ||
    "https://t.me/+tww-HqO8htBiMzdk",
};

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `PUBLIC_BASE_URL` oppure `RENDER_EXTERNAL_URL` (Render). */
function resolvePublicBaseUrl(): string | undefined {
  const raw =
    process.env.PUBLIC_BASE_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    "";
  if (!raw) return undefined;
  return stripTrailingSlash(raw);
}

/**
 * URL per `InlineKeyboard.webApp`.
 * `TOS_URL` (se non vuoto) ha priorità; altrimenti `${publicBase}/tos`.
 */
function resolveTosWebAppUrl(): string | undefined {
  const explicit = process.env.TOS_URL?.trim();
  if (explicit) return explicit;
  const base = resolvePublicBaseUrl();
  if (!base) return undefined;
  return `${base}/tos`;
}

function parseChannelId(
  raw: string | undefined,
): string | number | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v.startsWith("@")) return v;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  return v;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  const n = Number(raw?.trim() || "");
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export function assertConfig(): void {
  requireEnv("TELEGRAM_BOT_TOKEN");
}
