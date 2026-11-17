import { createServer, type Server } from "node:http";
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

/**
 * HTTP minimo per PaaS (Render/Railway/Fly).
 * Bind immediato su 0.0.0.0:PORT; la Promise risolve solo dopo listening.
 * Serve anche la Mini App ToS su GET /tos.
 */
export function startHealthServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    if (path === "/tos" || path === "/tos/") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      });
      res.end(TOS_HTML);
      return;
    }
    if (path === "/healthz" || path === "/" || path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "telegram-escrow-it" }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      console.log(
        `Health HTTP in ascolto su 0.0.0.0:${port} (/healthz, /tos)`,
      );
      resolve(server);
    });
  });
}
