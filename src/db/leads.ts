import { Pool } from "pg";
import { LeadState } from "../state-machine";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface Lead {
  id: number;
  phone: string;
  state: LeadState;
  name: string | null;
  objective: string | null;
  timeline: string | null;
  budget: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LeadData {
  name?: string;
  objective?: string;
  timeline?: string;
  budget?: string;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/**
 * Fetch a lead by phone number. Returns null if not found.
 */
export async function getLead(phone: string): Promise<Lead | null> {
  const { rows } = await pool.query<Lead>(
    `SELECT id, phone, state, name, objective, timeline, budget, created_at, updated_at
     FROM leads
     WHERE phone = $1
     LIMIT 1`,
    [phone]
  );
  return rows[0] ?? null;
}

/**
 * Insert or update a lead record, merging only the provided fields.
 */
export async function upsertLead(
  phone: string,
  state: LeadState,
  data: LeadData = {}
): Promise<Lead> {
  const { rows } = await pool.query<Lead>(
    `INSERT INTO leads (phone, state, name, objective, timeline, budget, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (phone) DO UPDATE SET
       state      = EXCLUDED.state,
       name       = COALESCE(EXCLUDED.name,      leads.name),
       objective  = COALESCE(EXCLUDED.objective,  leads.objective),
       timeline   = COALESCE(EXCLUDED.timeline,   leads.timeline),
       budget     = COALESCE(EXCLUDED.budget,     leads.budget),
       updated_at = NOW()
     RETURNING id, phone, state, name, objective, timeline, budget, created_at, updated_at`,
    [
      phone,
      state,
      data.name ?? null,
      data.objective ?? null,
      data.timeline ?? null,
      data.budget ?? null,
    ]
  );
  return rows[0]!;
}

/**
 * Append a message to the conversation log for a lead.
 */
export async function logMessage(
  leadId: number,
  role: "user" | "assistant" | "system",
  content: string
): Promise<void> {
  await pool.query(
    `INSERT INTO messages (lead_id, role, content) VALUES ($1, $2, $3)`,
    [leadId, role, content]
  );
}

/**
 * Retrieve the last N messages for a lead (for context window rebuilding).
 */
export async function getRecentMessages(
  leadId: number,
  limit = 10
): Promise<{ role: string; content: string }[]> {
  const { rows } = await pool.query<{ role: string; content: string }>(
    `SELECT role, content
     FROM messages
     WHERE lead_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [leadId, limit]
  );
  // Return in chronological order
  return rows.reverse();
}
