import { createServer, type Server } from "node:http";

/**
 * HTTP minimo per PaaS (Render/Railway/Fly) che richiedono una porta aperta.
 * Il bot resta in long-polling su Telegram.
 */
export function startHealthServer(port: number): Server {
  const server = createServer((req, res) => {
    if (req.url === "/healthz" || req.url === "/" || req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "telegram-escrow-it" }));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health HTTP su :${port} (/healthz)`);
  });

  return server;
}
