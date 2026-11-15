import { assertConfig, config } from "./config.js";
import { createBot } from "./bot.js";
import { startHealthServer } from "./health.js";

async function main(): Promise<void> {
  assertConfig();

  const port = Number(process.env.PORT || 0);
  if (Number.isFinite(port) && port > 0) {
    startHealthServer(port);
  }

  const bot = createBot(config.botToken);
  const me = await bot.api.getMe();
  config.botUsername = me.username;

  // Necessario per kick/join controparte e promozione admin
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
