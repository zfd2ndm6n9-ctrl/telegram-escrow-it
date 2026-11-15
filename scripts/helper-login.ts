/**
 * Genera TELEGRAM_HELPER_SESSION per l'account user che crea i gruppi escrow.
 *
 * Prerequisiti:
 * 1. Crea un'app su https://my.telegram.org → api_id + api_hash
 * 2. Usa un account Telegram dedicato (non il tuo personale se possibile)
 * 3. Esporta:
 *    TELEGRAM_API_ID=…
 *    TELEGRAM_API_HASH=…
 * 4. npm run helper:login
 * 5. Incolla telefono / codice / 2FA quando chiesto
 * 6. Copia la session string su Render come TELEGRAM_HELPER_SESSION
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import "dotenv/config";

async function prompt(rl: ReturnType<typeof createInterface>, label: string) {
  return (await rl.question(label)).trim();
}

async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID?.trim() || "0");
  const apiHash = process.env.TELEGRAM_API_HASH?.trim() || "";
  if (!apiId || !apiHash) {
    console.error(
      "Imposta TELEGRAM_API_ID e TELEGRAM_API_HASH (my.telegram.org) poi rilancia.",
    );
    process.exit(1);
  }

  const rl = createInterface({ input, output });
  const session = new StringSession("");
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });

  try {
    await client.start({
      phoneNumber: async () => prompt(rl, "Numero telefono (con prefisso, es. +39…): "),
      phoneCode: async () => prompt(rl, "Codice Telegram: "),
      password: async () => prompt(rl, "Password 2FA (se attiva): "),
      onError: (err) => console.error(err),
    });

    const saved = client.session.save() as unknown as string;
    console.log("\n✅ Sessione OK. Imposta su Render / .env:\n");
    console.log(`TELEGRAM_HELPER_SESSION=${saved}\n`);
    console.log(
      "L'account helper resterà owner dei gruppi (le parti entrano come membri).",
    );
  } finally {
    rl.close();
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
