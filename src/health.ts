import { createServer, type Server } from "node:http";

/**
 * HTTP minimo per PaaS (Render/Railway/Fly).
 * Bind immediato su 0.0.0.0:PORT; la Promise risolve solo dopo listening.
 */
export function startHealthServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
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
      console.log(`Health HTTP in ascolto su 0.0.0.0:${port} (/healthz)`);
      resolve(server);
    });
  });
}
