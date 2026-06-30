import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Send a conversation to OpenAI and return the assistant reply.
 */
export async function chat(
  messages: Message[],
  systemPrompt: string
): Promise<string> {
  const fullMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: fullMessages,
    max_tokens: 400,
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content?.trim() ?? "";
}

// ── Bot / takeover detection ─────────────────────────────────────────────────

/**
 * Returns true if the message content looks like it was sent by another bot
 * (auto-responder, IVR menu, another AI assistant, etc.).
 */
export function isBotMessage(content: string): boolean {
  const lower = content.toLowerCase();

  const botSignals = [
    /sou um assistente/i,
    /atendimento autom[aá]tico/i,
    /bot de atendimento/i,
    /respostas autom[aá]ticas/i,
    // Numbered IVR-style menus
    /^\s*1[.)]\s+.+\n\s*2[.)]\s+/m,
    // Common auto-responder openers
    /obrigado por entrar em contato.*responder[ei]* em breve/i,
    /sua mensagem foi recebida/i,
    /este [eé] um e?-?mail autom[aá]tico/i,
    /n[aã]o responda a este/i,
  ];

  return botSignals.some((pattern) => pattern.test(lower));
}

/**
 * Returns true if the message was sent by a human agent taking over
 * the conversation (from_me=true but NOT from the configured bot sender).
 */
export function isHumanTakeover(
  fromMe: boolean,
  senderId: number | string | null
): boolean {
  if (!fromMe) return false;

  const botSenderId = process.env.CHATWOOT_BOT_SENDER_ID;
  if (!botSenderId) return false;

  // If the sender is not the bot account, a human is writing
  return String(senderId) !== String(botSenderId);
}
