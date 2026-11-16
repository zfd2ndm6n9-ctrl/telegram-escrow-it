import { assertConfig, config } from "./config.js";
import { createBot } from "./bot.js";
import { startHealthServer } from "./health.js";
import {
  getMasterKeypair,
  isSolanaConfigured,
  startDepositWatcher,
} from "./services/solana/index.js";
import {
  getMtprotoHelper,
  isMtprotoHelperConfigured,
  stopMtprotoHelper,
} from "./services/mtproto-helper.js";

async function main(): Promise<void> {
  // Render Web Service: aprire PORT subito, prima di Telegram / assertConfig
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : 0;
  if (Number.isFinite(port) && port > 0) {
    await startHealthServer(port);
  } else {
    console.log("PORT non impostato: nessun health HTTP (ok in locale senza PaaS).");
  }

  assertConfig();

  if (isSolanaConfigured()) {
    const master = await getMasterKeypair();
    if (master) {
      console.log(
        `Escrow SOL mainnet attivo. Master pubkey: ${master.publicKey.toBase58()}`,
      );
      console.log(
        "⚠️ Hot wallet: tieni solo importi di test piccoli. Secret solo su Render env.",
      );
    }
  } else {
    console.warn(
      "SOLANA_PRIVATE_KEY assente: /crea on-chain disabilitato finché non la imposti.",
    );
  }

  const { bot, store } = createBot(config.botToken);
  console.log(
    `Persistenza deal: DATA_DIR=${store.dataDir} → ${store.path} (${store.size} deal). ` +
      "Su Render serve Persistent Disk: senza volume i deal spariscono al redeploy.",
  );
  const me = await bot.api.getMe();
  config.botUsername = me.username;

  if (config.telegramBotCreatesGroups) {
    if (isMtprotoHelperConfigured()) {
      try {
        await getMtprotoHelper();
      } catch (err) {
        console.warn(
          "TELEGRAM_BOT_CREATES_GROUPS=1 ma helper MTProto non disponibile (soft-fallback a gruppo manuale):",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        "TELEGRAM_BOT_CREATES_GROUPS=1 ma mancano TELEGRAM_API_ID/HASH/HELPER_SESSION: path felice = gruppo manuale + /avvia.",
      );
    }
  } else {
    console.log(
      "Creazione automatica gruppi OFF (default). Path felice: gruppo privato → bot admin → /avvia. Gate: TELEGRAM_BOT_CREATES_GROUPS=1.",
    );
  }

  const watcher = startDepositWatcher(
    store,
    bot.api,
    Number.isFinite(config.solanaWatchIntervalMs)
      ? config.solanaWatchIntervalMs
      : 20_000,
  );

  const allowed_updates = [
    "message",
    "callback_query",
    "my_chat_member",
    "chat_member",
  ] as const;

  console.log(`Bot avviato in polling: @${me.username} (id ${me.id})`);

  const stop = async () => {
    watcher.stop();
    await stopMtprotoHelper();
    await bot.stop();
  };
  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  await bot.start({
    allowed_updates: [...allowed_updates],
    onStart: () => {
      console.log("Polling attivo. Ctrl+C per terminare.");
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
