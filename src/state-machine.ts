import { chat } from "./agent";
import { getLead, upsertLead, logMessage } from "./db/leads";

export enum LeadState {
  WAITING = "WAITING",
  GREETING = "GREETING",
  Q1_OBJECTIVE = "Q1_OBJECTIVE",
  Q2_TIMELINE = "Q2_TIMELINE",
  Q3_BUDGET = "Q3_BUDGET",
  SCHEDULING = "SCHEDULING",
  CLOSED = "CLOSED",
  DISQUALIFIED = "DISQUALIFIED",
}

export interface LeadData {
  name?: string;
  objective?: string;
  timeline?: string;
  budget?: string;
}

interface TransitionResult {
  response: string;
  newState: LeadState;
}

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const MIN_BUDGET = parseInt(process.env.MIN_BUDGET ?? "5000", 10);

const PRODUCT_CONTEXT = `
You are an AI sales assistant for a company that offers automation and AI solutions for businesses.
Your goal is to qualify leads by understanding their needs, timeline, and budget.
Be friendly, concise, and professional. Write in Brazilian Portuguese.
Never reveal you are an AI unless directly asked — and if asked, admit it honestly.
Keep messages short (2-4 sentences max). No emojis unless the user uses them first.
`.trim();

export class StateMachine {
  private leadId: number | null;
  private phone: string;
  public currentState: LeadState;

  constructor(phone: string, leadId: number | null, currentState: LeadState) {
    this.phone = phone;
    this.leadId = leadId;
    this.currentState = currentState;
  }

  async transition(
    incomingMessage: string,
    leadData: LeadData = {}
  ): Promise<TransitionResult> {
    switch (this.currentState) {
      case LeadState.WAITING:
      case LeadState.GREETING:
        return this.handleGreeting(incomingMessage, leadData);

      case LeadState.Q1_OBJECTIVE:
        return this.handleQ1(incomingMessage, leadData);

      case LeadState.Q2_TIMELINE:
        return this.handleQ2(incomingMessage, leadData);

      case LeadState.Q3_BUDGET:
        return this.handleQ3(incomingMessage, leadData);

      case LeadState.SCHEDULING:
        return this.handleScheduling(incomingMessage, leadData);

      case LeadState.CLOSED:
      case LeadState.DISQUALIFIED:
        return {
          response: "",
          newState: this.currentState,
        };

      default:
        return this.handleGreeting(incomingMessage, leadData);
    }
  }

  // ── State handlers ──────────────────────────────────────────────────────────

  private async handleGreeting(
    message: string,
    data: LeadData
  ): Promise<TransitionResult> {
    const systemPrompt = `${PRODUCT_CONTEXT}

The lead just initiated contact. Greet them warmly, introduce yourself briefly as an assistant,
and ask their name if you don't have it yet.
Then ask what challenge or objective brought them to contact us today.
End with one clear question only.`;

    const messages: Message[] = [{ role: "user", content: message }];
    const response = await chat(messages, systemPrompt);

    return { response, newState: LeadState.Q1_OBJECTIVE };
  }

  private async handleQ1(
    message: string,
    data: LeadData
  ): Promise<TransitionResult> {
    // Check for disqualification signals
    if (isNotInterested(message)) {
      const response = await chat(
        [{ role: "user", content: message }],
        `${PRODUCT_CONTEXT}
The lead indicated they are not interested or are leaving.
Thank them politely, leave the door open for the future, and say goodbye.`
      );
      return { response, newState: LeadState.DISQUALIFIED };
    }

    const systemPrompt = `${PRODUCT_CONTEXT}

The lead just described their main objective or challenge: "${message}"
Acknowledge it briefly and empathetically.
Then ask: in what timeframe are they looking to implement a solution?
(e.g. immediately, within 1-3 months, 3-6 months, or just exploring)
End with one clear question only.`;

    const messages: Message[] = [{ role: "user", content: message }];
    const response = await chat(messages, systemPrompt);

    return { response, newState: LeadState.Q2_TIMELINE };
  }

  private async handleQ2(
    message: string,
    data: LeadData
  ): Promise<TransitionResult> {
    if (isNotInterested(message)) {
      const response = await chat(
        [{ role: "user", content: message }],
        `${PRODUCT_CONTEXT}
The lead indicated they are not interested or are leaving.
Thank them politely and say goodbye.`
      );
      return { response, newState: LeadState.DISQUALIFIED };
    }

    const systemPrompt = `${PRODUCT_CONTEXT}

The lead shared their timeline: "${message}"
Acknowledge it.
Now ask about their available budget or investment range for this project.
Be natural — frame it as helping match the right solution to their reality.
End with one clear question only.`;

    const messages: Message[] = [{ role: "user", content: message }];
    const response = await chat(messages, systemPrompt);

    return { response, newState: LeadState.Q3_BUDGET };
  }

  private async handleQ3(
    message: string,
    data: LeadData
  ): Promise<TransitionResult> {
    if (isNotInterested(message)) {
      const response = await chat(
        [{ role: "user", content: message }],
        `${PRODUCT_CONTEXT}
The lead indicated they are not interested.
Thank them politely and say goodbye.`
      );
      return { response, newState: LeadState.DISQUALIFIED };
    }

    const budgetValue = extractBudgetNumber(message);
    const qualified = budgetValue === null || budgetValue >= MIN_BUDGET;

    if (!qualified) {
      const systemPrompt = `${PRODUCT_CONTEXT}

The lead mentioned a budget of approximately R$${budgetValue?.toLocaleString("pt-BR")},
which is below our minimum engagement threshold of R$${MIN_BUDGET.toLocaleString("pt-BR")}.
Politely explain that the investment level for our solutions starts at R$${MIN_BUDGET.toLocaleString("pt-BR")},
thank them for their time, and suggest they can return when ready.`;

      const response = await chat(
        [{ role: "user", content: message }],
        systemPrompt
      );
      return { response, newState: LeadState.DISQUALIFIED };
    }

    const systemPrompt = `${PRODUCT_CONTEXT}

The lead confirmed a budget in range: "${message}". They are qualified.
Celebrate briefly (e.g. "Ótimo, parece que faz sentido!").
Tell them the next step is a short discovery call with a specialist.
Ask them what days and times work best for them this week or next.
End with one clear question only.`;

    const messages: Message[] = [{ role: "user", content: message }];
    const response = await chat(messages, systemPrompt);

    return { response, newState: LeadState.SCHEDULING };
  }

  private async handleScheduling(
    message: string,
    data: LeadData
  ): Promise<TransitionResult> {
    const systemPrompt = `${PRODUCT_CONTEXT}

The lead proposed a time for the call: "${message}"
Confirm the meeting enthusiastically, summarize what you know about their need,
and tell them a specialist will confirm the exact link/details shortly.
Thank them and close the conversation warmly.`;

    const messages: Message[] = [{ role: "user", content: message }];
    const response = await chat(messages, systemPrompt);

    return { response, newState: LeadState.CLOSED };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isNotInterested(message: string): boolean {
  const lower = message.toLowerCase();
  const signals = [
    "nao tenho interesse",
    "não tenho interesse",
    "nao quero",
    "não quero",
    "tchau",
    "obrigado mas nao",
    "obrigado mas não",
    "para de me mandar",
    "me tire da lista",
    "não preciso",
    "nao preciso",
    "desinteressado",
    "sem interesse",
  ];
  return signals.some((s) => lower.includes(s));
}

function extractBudgetNumber(message: string): number | null {
  // Strip formatting and pull out the largest number mentioned
  const cleaned = message
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .toLowerCase()
    .replace("mil", "000");

  const matches = cleaned.match(/\d+(\.\d+)?/g);
  if (!matches) return null;

  const values = matches.map((m) => parseFloat(m));
  return Math.max(...values);
}
