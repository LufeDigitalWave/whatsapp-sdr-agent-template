import { createClient } from "redis";

let _client: ReturnType<typeof createClient> | null = null;

async function getClient() {
  if (!_client) {
    _client = createClient({ url: process.env.REDIS_URL });
    _client.on("error", (err: Error) =>
      console.error("[redis] client error:", err.message)
    );
    await _client.connect();
  }
  return _client;
}

const DEFAULT_TTL_SECONDS = 60; // ignore duplicates within 1 minute

/**
 * Returns true if this messageId has been seen within the TTL window.
 * On first call, sets the key in Redis and returns false (not a duplicate).
 *
 * Uses SET NX (set-if-not-exists) which is atomic — safe under concurrent requests.
 */
export async function isDuplicate(
  messageId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<boolean> {
  const client = await getClient();
  const key = `dedup:msg:${messageId}`;

  // SET key 1 NX EX ttl — returns "OK" if set, null if already existed
  const result = await client.set(key, "1", {
    NX: true,
    EX: ttlSeconds,
  });

  // result is "OK" when newly set (not a duplicate), null when key already existed (duplicate)
  return result === null;
}

/**
 * Gracefully disconnect the Redis client.
 * Call during process shutdown.
 */
export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
  }
}
