import https from "node:https";
import http from "node:http";

const CHATWOOT_URL = (process.env.CHATWOOT_URL ?? "").replace(/\/$/, "");
const API_TOKEN = process.env.CHATWOOT_API_TOKEN ?? "";
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID ?? "1";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  inbox_id: number;
  status: string;
  meta: {
    sender: {
      id: number;
      name: string;
      phone_number?: string;
    };
  };
}

export interface WebhookEvent {
  conversationId: number;
  messageId: string;
  phone: string;
  content: string;
  fromMe: boolean;
  senderId: number | null;
  senderName: string;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function chatwootFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<unknown> {
  const url = `${CHATWOOT_URL}/api/v1/accounts/${ACCOUNT_ID}${path}`;
  const body = options.body ? JSON.stringify(options.body) : undefined;

  const urlObj = new URL(url);
  const isHttps = urlObj.protocol === "https:";
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          api_access_token: API_TOKEN,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Send a text message to a Chatwoot conversation.
 */
export async function sendMessage(
  conversationId: number,
  content: string
): Promise<void> {
  await chatwootFetch(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: {
      content,
      message_type: "outgoing",
      private: false,
    },
  });
}

/**
 * Fetch a conversation object from Chatwoot.
 */
export async function getConversation(id: number): Promise<Conversation> {
  const data = await chatwootFetch(`/conversations/${id}`);
  return data as Conversation;
}

/**
 * Parse a raw Chatwoot webhook payload.
 * Returns null if the event should be ignored (e.g. outgoing from bot, status change).
 */
export function parseChatwootWebhook(body: unknown): WebhookEvent | null {
  if (!body || typeof body !== "object") return null;

  const payload = body as Record<string, unknown>;

  // Only handle message_created events
  if (payload.event !== "message_created") return null;

  const message = payload as {
    id?: number;
    content?: string;
    message_type?: string;
    sender?: { id?: number; name?: string; phone_number?: string };
    conversation?: { id?: number };
    from_me?: boolean;
  };

  const conversationId = message.conversation?.id;
  if (!conversationId) return null;

  const content = message.content ?? "";
  if (!content.trim()) return null;

  // message_type: "incoming" = from lead, "outgoing" = from agent/bot
  const isIncoming = message.message_type === "incoming";
  const isOutgoing = message.message_type === "outgoing";

  // fromMe is true for outgoing messages
  const fromMe = isOutgoing;

  // Extract phone — Chatwoot stores it on the sender for incoming messages
  const rawPhone =
    message.sender?.phone_number ?? extractPhoneFromJid(payload);

  const phone = normalizePhone(rawPhone ?? "");
  if (!phone) return null;

  return {
    conversationId,
    messageId: String(message.id ?? `${conversationId}-${Date.now()}`),
    phone,
    content,
    fromMe,
    senderId: message.sender?.id ?? null,
    senderName: message.sender?.name ?? "",
  };
}

// ── Phone normalization ──────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  // Strip @s.whatsapp.net / @lid / @c.us suffixes (UAZapi / Evolution quirks)
  return raw.replace(/@(s\.whatsapp\.net|lid|c\.us)$/i, "").replace(/\D/g, "");
}

function extractPhoneFromJid(payload: Record<string, unknown>): string | null {
  // Some webhook formats embed the JID in different places
  const jid =
    (payload.senderJid as string) ??
    (payload.sender_jid as string) ??
    null;
  return jid ? jid : null;
}
