import { assertConfig, config } from "./config.js";
import { createBot } from "./bot.js";

async function main(): Promise<void> {
  assertConfig();

  const bot = createBot(config.botToken);
  const me = await bot.api.getMe();
  config.botUsername = me.username;

  console.log(`Bot avviato in polling: @${me.username} (id ${me.id})`);

  await bot.start({
    onStart: () => {
      console.log("Polling attivo. Ctrl+C per terminare.");
    },
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
