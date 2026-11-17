import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Variabile d'ambiente mancante: ${name}. Copia .env.example in .env oppure esporta la variabile.`,
    );
  }
  return value;
}

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "",
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID?.trim() || undefined,
  /** URL ToS pubblici; se assente il pulsante risponde “in arrivo” */
  tosUrl: process.env.TOS_URL?.trim() || undefined,
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
  defaultAsset: "SOL" as const,
  /**
   * Cartella persistente per deals.json e members.json.
   * Su Render: montare un Persistent Disk e puntare qui (es. /var/data).
   * Default locale: `data` (gitignored).
   */
  dataDir: process.env.DATA_DIR?.trim() || "data",
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
   * Se `1`/`true` e helper MTProto configurato, dopo /crea il bot tenta di creare il gruppo.
   * Default off: UX = crea gruppo privato → aggiungi bot admin → /avvia.
   */
  telegramBotCreatesGroups: ["1", "true", "yes"].includes(
    (process.env.TELEGRAM_BOT_CREATES_GROUPS?.trim() || "").toLowerCase(),
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
};

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
