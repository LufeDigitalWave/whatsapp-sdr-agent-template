import "dotenv/config";
import { app } from "./app";
import { pool } from "./db/leads";
import { closeRedis } from "./dedup";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const server = app.listen(PORT, () => {
  console.log(`[server] WhatsApp SDR Agent running on port ${PORT}`);
  console.log(`[server] Health check: http://localhost:${PORT}/health`);
  console.log(`[server] Webhook endpoint: http://localhost:${PORT}/webhook/chatwoot`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);

  server.close(async () => {
    try {
      await pool.end();
      await closeRedis();
      console.log("[server] All connections closed. Goodbye.");
      process.exit(0);
    } catch (err) {
      console.error("[server] Error during shutdown:", err);
      process.exit(1);
    }
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error("[server] Forced exit after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
