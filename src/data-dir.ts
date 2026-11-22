import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ResolveDataDirOptions = {
  cwd?: string;
  warn?: (message: string) => void;
};

/**
 * Resolve `DATA_DIR` to an absolute path.
 *
 * Render Persistent Disk is mounted at `/var/data`. A dashboard typo
 * `DATA_DIR=var/data` (missing leading `/`) resolves under the process cwd
 * (Docker/Node WORKDIR `/app` → `/app/var/data`), so deals/members/invites
 * never land on the disk and `/crea` cannot see codes created after restart.
 */
export function resolveDataDir(
  rawEnv: string | undefined = process.env.DATA_DIR,
  opts: ResolveDataDirOptions = {},
): string {
  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const cwd = opts.cwd ?? process.cwd();
  let raw = rawEnv?.trim() || "data";

  // Classic Render misconfig: relative "var/data" instead of "/var/data".
  if (raw === "var/data" || raw === "./var/data") {
    warn(
      `DATA_DIR="${raw}" manca lo slash iniziale: uso /var/data (Persistent Disk). ` +
        `Imposta DATA_DIR=/var/data nel dashboard Render (path assoluto).`,
    );
    raw = "/var/data";
  }

  const absolute = resolve(cwd, raw);
  if (!isAbsolute(raw)) {
    warn(
      `DATA_DIR="${raw}" è relativo → ${absolute}. ` +
        `In produzione usa un path assoluto (Render: DATA_DIR=/var/data).`,
    );
  }

  const legacyRelative = resolve(cwd, "var/data");
  if (
    absolute === "/var/data" &&
    legacyRelative !== absolute &&
    !existsSync(resolve(absolute, "members.json")) &&
    !existsSync(resolve(absolute, "invites.json")) &&
    (existsSync(resolve(legacyRelative, "members.json")) ||
      existsSync(resolve(legacyRelative, "invites.json")))
  ) {
    warn(
      `Store legacy trovato in ${legacyRelative}, ma DATA_DIR=/var/data è vuoto. ` +
        `Copia i JSON sul Persistent Disk (es. cp ${legacyRelative}/*.json /var/data/) ` +
        `oppure ricrea iscritti/inviti dopo il fix.`,
    );
  }

  return absolute;
}
