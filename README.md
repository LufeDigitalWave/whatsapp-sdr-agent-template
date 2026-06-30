# WhatsApp SDR Agent Template

![Node 20](https://img.shields.io/badge/Node-20-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-gpt--4.1-412991?logo=openai&logoColor=white)
![License MIT](https://img.shields.io/badge/License-MIT-22c55e)

A production-ready TypeScript template for building WhatsApp AI agents that qualify sales leads autonomously. The agent conducts a structured conversation — greeting, three qualification questions, and scheduling — driven by a finite state machine. Each lead's state persists in PostgreSQL; Redis prevents duplicate message processing. The bot integrates with Chatwoot as the inbox layer, detects human takeover automatically, and never replies to other bots.

---

## Features

- **FSM-based conversation flow** — deterministic state transitions with full audit trail
- **Chatwoot integration** — webhook receiver + outgoing message API
- **OpenAI gpt-4.1** — each state handler uses a focused system prompt; context stays tight
- **Message deduplication** — Redis SET NX prevents processing the same webhook twice
- **Bot detection** — regex heuristics filter IVR menus and auto-responders
- **Human takeover detection** — bot steps back when a human agent writes to the conversation
- **Budget qualification** — configurable minimum threshold; sub-threshold leads get a polite exit
- **Docker-ready** — single `docker compose up` starts app + Postgres + Redis with health checks
- **Graceful shutdown** — SIGTERM/SIGINT drain in-flight requests, close DB pool and Redis

---

## Architecture

```
WhatsApp → Chatwoot → POST /webhook/chatwoot
                              │
                         parseChatwootWebhook()
                              │
                       ┌──────▼──────┐
                       │  dedup (Redis) │  ← skip if seen within 60s
                       └──────┬──────┘
                              │
                       ┌──────▼──────┐
                       │ StateMachine │  ← loads lead from Postgres
                       └──────┬──────┘
                              │
                       ┌──────▼──────┐
                       │  OpenAI     │  ← state-specific system prompt
                       └──────┬──────┘
                              │
                   persist state + log messages
                              │
                       sendMessage() → Chatwoot → WhatsApp
```

---

## Conversation State Flow

```
                ┌─────────┐
  new lead ───► │ WAITING │
                └────┬────┘
                     │ first message
                ┌────▼────┐
                │GREETING │  "Oi! Sou a assistente da Empresa X. Como posso ajudar?"
                └────┬────┘
                     │
              ┌──────▼──────┐
              │ Q1_OBJECTIVE│  "Qual desafio você quer resolver?"
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │ Q2_TIMELINE │  "Em quanto tempo precisa de uma solução?"
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │  Q3_BUDGET  │  "Qual o investimento previsto?"
              └──┬──────┬───┘
                 │      │
    budget OK    │      │  budget < MIN_BUDGET
                 │      │  or not interested
          ┌──────▼──┐  ┌▼──────────────┐
          │SCHEDULING│  │ DISQUALIFIED  │
          └──────┬───┘  └───────────────┘
                 │
          ┌──────▼──┐
          │  CLOSED │  "Perfeito! Um especialista vai confirmar o link."
          └─────────┘
```

At any state, if the lead sends a disinterest signal ("não tenho interesse", "me tire da lista", etc.), the machine moves directly to `DISQUALIFIED` with a graceful goodbye.

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/LufeDigitalWave/whatsapp-sdr-agent-template.git
cd whatsapp-sdr-agent-template
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration](#configuration) below).

### 2. Start with Docker Compose

```bash
docker compose up --build
```

The migration file `migrations/001_initial.sql` runs automatically on first start via the Postgres `docker-entrypoint-initdb.d` hook.

### 3. Expose your webhook (local dev)

```bash
# Install ngrok: https://ngrok.com
ngrok http 3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok.io`) and set it as the Chatwoot webhook URL:

- Chatwoot → Settings → Integrations → Webhooks → New Webhook
- URL: `https://abc123.ngrok.io/webhook/chatwoot`
- Events: check **Message Created**

### 4. Verify the health endpoint

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"2026-06-30T12:00:00.000Z"}
```

### Local development (no Docker)

```bash
npm install
# Start Postgres and Redis locally (e.g. via Docker or Homebrew)
npm run dev   # tsx watch — hot reload on save
```

---

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP port the server listens on |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | Yes (Docker) | — | Password for the `sdr` Postgres user |
| `REDIS_URL` | Yes | — | Redis connection URL |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4.1` | OpenAI model ID |
| `CHATWOOT_URL` | Yes | — | Base URL of your Chatwoot instance |
| `CHATWOOT_API_TOKEN` | Yes | — | Chatwoot user access token |
| `CHATWOOT_ACCOUNT_ID` | Yes | `1` | Chatwoot account ID |
| `CHATWOOT_BOT_SENDER_ID` | Yes | — | Numeric ID of the bot's Chatwoot agent account |
| `MIN_BUDGET` | No | `5000` | Minimum budget in BRL for qualification |
| `ADMIN_WHATSAPP` | No | — | Phone number for admin alerts (e.g. `5511999999999`) |

> **Finding `CHATWOOT_BOT_SENDER_ID`**: In Chatwoot, go to Settings → Agents, find the bot agent, and note its numeric ID from the URL or API (`GET /api/v1/accounts/{id}/agents`).

---

## How to Customize

### Add a new qualification question

1. Add a state to the enum in `src/state-machine.ts`:
   ```ts
   export enum LeadState {
     // ...existing states...
     Q4_TEAM_SIZE = "Q4_TEAM_SIZE",
   }
   ```

2. Add a handler method:
   ```ts
   private async handleQ4(message: string, data: LeadData): Promise<TransitionResult> {
     const systemPrompt = `${PRODUCT_CONTEXT}
   The lead answered about budget. Now ask how large their team is.`;
     const response = await chat([{ role: "user", content: message }], systemPrompt);
     return { response, newState: LeadState.SCHEDULING };
   }
   ```

3. Wire it into the `transition()` switch statement and update the previous state to point to `Q4_TEAM_SIZE` instead of `SCHEDULING`.

### Change the conversation language or persona

Edit the `PRODUCT_CONTEXT` constant at the top of `src/state-machine.ts`. All state handlers inherit it as part of their system prompt.

### Adjust the system prompt per state

Each `handleQ*` method builds its own `systemPrompt` string. Modify the instruction text inside any handler to change tone, add domain context, or impose response length constraints.

### Add a follow-up drip cadence

The `followup_queue` table is already in the migration. Insert rows with `send_at` timestamps for D+3/D+7 re-engagement, then run a separate worker that polls the table and calls `sendMessage()`.

---

## Database Schema

| Table | Purpose |
|---|---|
| `leads` | One row per phone number; stores current FSM state and qualification answers |
| `messages` | Full conversation log (user + assistant turns) per lead |
| `followup_queue` | Scheduled re-engagement messages; `sent=FALSE` rows are pending |

---

## Project Structure

```
.
├── src/
│   ├── index.ts                 # Entrypoint — starts Express server
│   ├── app.ts                   # Express setup, middleware, error handler
│   ├── routes.ts                # POST /webhook/chatwoot, GET /health
│   ├── state-machine.ts         # FSM: LeadState enum + StateMachine class
│   ├── agent.ts                 # OpenAI wrapper, bot/takeover detection
│   ├── dedup.ts                 # Redis-backed message deduplication
│   ├── db/
│   │   └── leads.ts             # PostgreSQL queries (getLead, upsertLead, logMessage)
│   └── integrations/
│       └── chatwoot.ts          # sendMessage, getConversation, parseChatwootWebhook
├── migrations/
│   └── 001_initial.sql          # Creates leads, messages, followup_queue tables
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

---

## License

MIT — use freely, attribution appreciated.
