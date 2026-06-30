-- WhatsApp SDR Agent — Initial Schema
-- Run once against a fresh database.

-- ── Leads ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id          SERIAL PRIMARY KEY,
  phone       VARCHAR(30) UNIQUE NOT NULL,
  state       VARCHAR(30)        NOT NULL DEFAULT 'WAITING',
  name        VARCHAR(200),
  objective   TEXT,
  timeline    VARCHAR(100),
  budget      VARCHAR(100),
  created_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leads_state_idx       ON leads (state);
CREATE INDEX IF NOT EXISTS leads_updated_at_idx  ON leads (updated_at);

-- ── Conversation messages ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  lead_id     INT          NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  role        VARCHAR(20)  NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_lead_id_idx ON messages (lead_id, created_at);

-- ── Follow-up queue ───────────────────────────────────────────────────────────
-- Used for scheduled re-engagement messages (e.g. D+3, D+7 drip cadence).
CREATE TABLE IF NOT EXISTS followup_queue (
  id          SERIAL PRIMARY KEY,
  lead_id     INT          NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
  send_at     TIMESTAMPTZ  NOT NULL,
  template    VARCHAR(100) NOT NULL,
  sent        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS followup_queue_send_at_idx
  ON followup_queue (send_at)
  WHERE sent = FALSE;

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'leads_updated_at_trigger'
  ) THEN
    CREATE TRIGGER leads_updated_at_trigger
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
