import { assertConfig, config } from "../src/config.js";

async function main(): Promise<void> {
  assertConfig();
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
  const data = (await res.json()) as {
    ok: boolean;
    description?: string;
    result?: { username?: string; id: number; first_name: string };
  };
  if (!data.ok || !data.result) {
    console.error("getMe failed:", data.description ?? data);
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        username: data.result.username,
        id: data.result.id,
        first_name: data.result.first_name,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
