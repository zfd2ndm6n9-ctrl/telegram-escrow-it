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
   */
  solanaPrivateKey: process.env.SOLANA_PRIVATE_KEY?.trim() || undefined,
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
};

export function assertConfig(): void {
  requireEnv("TELEGRAM_BOT_TOKEN");
}
