import type { ChatCompletionFunctionTool } from "openai/resources/chat/completions";

/**
 * Everything that differs between handling a lead and handling a patient. The agent loop itself
 * (runAgent.ts) is the same for both; it just runs whichever profile matches the record.
 */
export type AgentProfile<TRecord, TDecision> = {
  promptVersion: string;
  systemPrompt: string;
  tools: ChatCompletionFunctionTool[];

  /** Cases with one right answer skip the LLM entirely. Returns null when judgment is needed. */
  decideWithRules(record: TRecord): TDecision | null;
  /** The first user message: what the model knows about the record before calling any tools. */
  describeRecord(record: TRecord): string;
  runTool(name: string, args: unknown, record: TRecord): unknown;
  /** Schema check plus business rules. Problems go back to the model so it can fix them. */
  validateDecision(args: unknown, record: TRecord): DecisionCheck<TDecision>;
  /** Used when the agent can't reach a valid decision: hand the record to a human. */
  fallbackDecision(record: TRecord, reason: string): TDecision;
};

export type DecisionCheck<TDecision> =
  { ok: true; decision: TDecision } | { ok: false; problems: string[] };

type JsonSchemaProperty = {
  type: "string" | "number" | "boolean";
  description?: string;
  enum?: readonly string[];
};

export function defineTool(
  name: string,
  description: string,
  properties: Record<string, JsonSchemaProperty>,
  required: string[] = Object.keys(properties),
): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

export function checkMessageTool(channels: readonly string[]) {
  return defineTool(
    "check_message",
    "Checks a draft message against our sending rules. Returns the problems to fix, if any.",
    {
      channel: { type: "string", enum: channels },
      message: { type: "string", description: "The full draft message" },
    },
  );
}

export function submitDecisionTool(categories: readonly string[], channels: readonly string[]) {
  return defineTool(
    "submit_decision",
    "Submit the final decision for this record. Call this once, at the end.",
    {
      category: { type: "string", enum: categories },
      channel: { type: "string", enum: channels },
      escalate: {
        type: "boolean",
        description: "true when a human must act before anything is sent",
      },
      tone: { type: "string", description: "One or two words, e.g. friendly, consultative" },
      language: { type: "string", enum: ["en", "fr", "es"] },
      subject: { type: "string", description: "Email subject line. Leave out for other channels." },
      message: {
        type: "string",
        description: "The final message, or the brief for a human handoff",
      },
      rationale: { type: "string", description: "One or two sentences explaining the decision" },
      confidence: { type: "number", description: "0 to 1" },
    },
    ["category", "channel", "escalate", "tone", "language", "message", "rationale", "confidence"],
  );
}
