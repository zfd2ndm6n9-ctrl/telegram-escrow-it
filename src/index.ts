import { assertConfig, config } from "./config.js";
import { createBot } from "./bot.js";
import { startHealthServer } from "./health.js";

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

  const bot = createBot(config.botToken);
  const me = await bot.api.getMe();
  config.botUsername = me.username;

  const allowed_updates = [
    "message",
    "callback_query",
    "my_chat_member",
    "chat_member",
  ] as const;

  console.log(`Bot avviato in polling: @${me.username} (id ${me.id})`);

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
