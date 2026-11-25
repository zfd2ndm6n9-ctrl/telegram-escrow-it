import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOS_HTML = loadTosHtml();

function loadTosHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "public", "tos.html"),
    join(process.cwd(), "public", "tos.html"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  }
  console.warn(
    "public/tos.html non trovato: /tos servirà un fallback minimo. " +
      "Verifica COPY public nel Docker / working directory.",
  );
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Termini di servizio Escrowita</title></head><body><h1>ESCROWITA TOS</h1><p>Pagina non disponibile. Contatta l’amministratore.</p></body></html>`;
}

export type TosAcceptApiBody = {
  initData: string;
  dealId: string;
};

export type TosAcceptApiResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export type TosAcceptApiHandler = (
  body: TosAcceptApiBody,
) => Promise<TosAcceptApiResult>;

let tosAcceptHandler: TosAcceptApiHandler | undefined;

/** Collega il handler Accetta Mini App (dopo createBot). */
export function setTosAcceptApiHandler(
  handler: TosAcceptApiHandler | undefined,
): void {
  tosAcceptHandler = handler;
}

function readJsonBody(req: IncomingMessage, limit = 32_768): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(raw);
}

async function handleTosAccept(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!tosAcceptHandler) {
    sendJson(res, 503, {
      ok: false,
      error: "accept_unavailable",
    });
    return;
  }
  let raw: string;
  try {
    raw = await readJsonBody(req);
  } catch {
    sendJson(res, 413, { ok: false, error: "body_too_large" });
    return;
  }
  let parsed: Partial<TosAcceptApiBody>;
  try {
    parsed = JSON.parse(raw || "{}") as Partial<TosAcceptApiBody>;
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid_json" });
    return;
  }
  const initData =
    typeof parsed.initData === "string" ? parsed.initData.trim() : "";
  const dealId =
    typeof parsed.dealId === "string" ? parsed.dealId.trim() : "";
  if (!initData || !dealId) {
    sendJson(res, 400, { ok: false, error: "missing_fields" });
    return;
  }

  try {
    const result = await tosAcceptHandler({ initData, dealId });
    if (result.ok) {
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, result.status ?? 400, {
      ok: false,
      error: result.error,
    });
  } catch (err) {
    console.error("[tos-accept-api]", err);
    sendJson(res, 500, { ok: false, error: "internal" });
  }
}

/**
 * HTTP minimo per PaaS (Render/Railway/Fly).
 * Bind immediato su 0.0.0.0:PORT; la Promise risolve solo dopo listening.
 * Serve Mini App ToS su GET /tos e Accetta su POST /api/tos/accept.
 */
export function startHealthServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    const method = (req.method ?? "GET").toUpperCase();

    if (
      method === "POST" &&
      (path === "/api/tos/accept" || path === "/api/tos/accept/")
    ) {
      void handleTosAccept(req, res);
      return;
    }

    if (method === "GET" && (path === "/tos" || path === "/tos/")) {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      res.end(TOS_HTML);
      return;
    }
    if (
      method === "GET" &&
      (path === "/healthz" || path === "/" || path === "/health")
    ) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "telegram-escrow-it" }));
      return;
    }
    if (method === "OPTIONS" && path.startsWith("/api/")) {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      console.log(
        `Health HTTP in ascolto su 0.0.0.0:${port} (/healthz, /tos, POST /api/tos/accept)`,
      );
      resolve(server);
    });
  });
}
