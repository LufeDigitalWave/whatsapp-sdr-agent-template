import { Router, Request, Response, NextFunction } from "express";
import { parseChatwootWebhook, sendMessage } from "./integrations/chatwoot";
import { getLead, upsertLead, logMessage } from "./db/leads";
import { isDuplicate } from "./dedup";
import { isBotMessage, isHumanTakeover } from "./agent";
import { StateMachine, LeadState } from "./state-machine";

export const router = Router();

// ── Health check ─────────────────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Chatwoot webhook ─────────────────────────────────────────────────────────

router.post(
  "/webhook/chatwoot",
  async (req: Request, res: Response, next: NextFunction) => {
    // Always acknowledge quickly so Chatwoot doesn't retry
    res.status(200).json({ received: true });

    try {
      const event = parseChatwootWebhook(req.body);
      if (!event) return; // not a message_created or missing data

      const { conversationId, messageId, phone, content, fromMe, senderId } =
        event;

      // 1. Ignore messages sent by this bot
      if (
        fromMe &&
        String(senderId) === String(process.env.CHATWOOT_BOT_SENDER_ID)
      ) {
        return;
      }

      // 2. Detect human takeover — stop the bot
      if (isHumanTakeover(fromMe, senderId)) {
        console.log(
          `[routes] Human takeover detected on conversation ${conversationId}. Bot stepping back.`
        );
        return;
      }

      // 3. Ignore bot-to-bot messages
      if (isBotMessage(content)) {
        console.log(`[routes] Bot message detected, skipping: ${messageId}`);
        return;
      }

      // 4. Deduplication
      if (await isDuplicate(messageId)) {
        console.log(`[routes] Duplicate message ${messageId}, skipping.`);
        return;
      }

      // 5. Load or create lead state
      const existingLead = await getLead(phone);
      const currentState = (existingLead?.state as LeadState) ?? LeadState.WAITING;

      // 6. Skip if already in a terminal state
      if (
        currentState === LeadState.CLOSED ||
        currentState === LeadState.DISQUALIFIED
      ) {
        return;
      }

      // 7. Run the state machine
      const machine = new StateMachine(
        phone,
        existingLead?.id ?? null,
        currentState
      );

      const { response, newState } = await machine.transition(content, {
        name: existingLead?.name ?? undefined,
        objective: existingLead?.objective ?? undefined,
        timeline: existingLead?.timeline ?? undefined,
        budget: existingLead?.budget ?? undefined,
      });

      // 8. Persist updated lead state
      const updatedLead = await upsertLead(phone, newState, {});

      // 9. Log both turns
      await logMessage(updatedLead.id, "user", content);
      if (response) {
        await logMessage(updatedLead.id, "assistant", response);
      }

      // 10. Send reply via Chatwoot
      if (response) {
        await sendMessage(conversationId, response);
      }

      console.log(
        `[routes] ${phone} | ${currentState} -> ${newState} | msg: "${content.slice(0, 60)}"`
      );
    } catch (err) {
      // Log but don't crash — response was already sent
      console.error("[routes] Error processing webhook:", err);
    }
  }
);
