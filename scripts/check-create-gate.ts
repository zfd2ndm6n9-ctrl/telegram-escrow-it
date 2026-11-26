/**
 * Smoke: APP_ENV / CREATE_GATE defaults + create-deal gate wiring.
 * npm exec tsx scripts/check-create-gate.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

function loadConfig(env: NodeJS.ProcessEnv): {
  appEnv: string;
  createGate: string;
} {
  const script = `
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "x";
    const { config } = await import(${JSON.stringify(resolve(root, "src/config.ts"))});
    console.log(JSON.stringify({ appEnv: config.appEnv, createGate: config.createGate }));
  `;
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: root,
      env: { ...process.env, ...env, TELEGRAM_BOT_TOKEN: "x" },
      encoding: "utf8",
    },
  );
  if (r.status !== 0) {
    throw new Error(`config load failed: ${r.stderr || r.stdout}`);
  }
  const line = (r.stdout || "").trim().split("\n").filter(Boolean).pop()!;
  return JSON.parse(line) as { appEnv: string; createGate: string };
}

{
  const c = loadConfig({
    APP_ENV: "staging",
    CREATE_GATE: "",
    NODE_ENV: "development",
  });
  assert.equal(c.appEnv, "staging");
  assert.equal(c.createGate, "admin");
}

{
  const c = loadConfig({
    APP_ENV: "production",
    CREATE_GATE: "",
    NODE_ENV: "production",
  });
  assert.equal(c.appEnv, "production");
  assert.equal(c.createGate, "invite");
}

{
  const c = loadConfig({
    APP_ENV: "staging",
    CREATE_GATE: "invite",
    NODE_ENV: "production",
  });
  assert.equal(c.appEnv, "staging");
  assert.equal(c.createGate, "invite", "CREATE_GATE override wins");
}

{
  const c = loadConfig({
    APP_ENV: "",
    CREATE_GATE: "",
    NODE_ENV: "development",
  });
  assert.equal(c.appEnv, "development");
  assert.equal(c.createGate, "open");
}

// Soft-launch fail-safe: CREATE_GATE=open never sticks on production Node.
{
  const c = loadConfig({
    APP_ENV: "production",
    CREATE_GATE: "open",
    NODE_ENV: "production",
  });
  assert.equal(c.appEnv, "production");
  assert.equal(
    c.createGate,
    "invite",
    "production ignores CREATE_GATE=open → invite",
  );
}

{
  const c = loadConfig({
    APP_ENV: "development",
    CREATE_GATE: "open",
    NODE_ENV: "production",
  });
  assert.equal(
    c.createGate,
    "invite",
    "NODE_ENV=production coerces open → invite",
  );
}

{
  const createSrc = readFileSync(
    resolve(root, "src/handlers/create-deal.ts"),
    "utf8",
  );
  assert.match(createSrc, /createGate === "admin"/);
  assert.match(createSrc, /createGateAdminOnly/);

  const inviteSrc = readFileSync(
    resolve(root, "src/services/invite-step.ts"),
    "utf8",
  );
  assert.match(inviteSrc, /createGate === "invite"/);
  assert.match(inviteSrc, /createGateInviteAsk/);
  assert.match(inviteSrc, /isRetiredInviteCode/);

  const invitesSrc = readFileSync(
    resolve(root, "src/store/invites.ts"),
    "utf8",
  );
  assert.match(invitesSrc, /RETIRED_INVITE_CODES/);
  assert.match(invitesSrc, /KEYTEST/);
  assert.match(invitesSrc, /TESTKEY/);

  const startSrc = readFileSync(
    resolve(root, "src/handlers/start.ts"),
    "utf8",
  );
  assert.match(startSrc, /codiceoff/);
  assert.match(startSrc, /setActive\(code, false\)/);
  assert.match(startSrc, /includeInactive/);
  assert.match(startSrc, /codiceListEmptyActive/);
}

console.log("check-create-gate: ok");
