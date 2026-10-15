import type {
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatModel, TokenUsage } from "../llm/chatModel";
import type { UnifiedRecord } from "../records/unifiedRecord";
import { logger } from "../shared/logger";
import { describeError } from "../shared/retry";
import type { AgentProfile } from "./agentProfile";
import type { AgentDecision, DecidedBy } from "./decision";
import { leadProfile } from "./leadProfile";
import { patientProfile } from "./patientProfile";

// A normal run takes three steps: look up context, check the draft, submit.
// The extra room lets the model fix a rejected draft twice before we give up.
const MAX_STEPS = 6;

export type AgentStep =
  | { kind: "tool_call"; tool: string; args: unknown; result: unknown }
  | { kind: "decision_rejected"; args: unknown; problems: string[] }
  | { kind: "text_reply"; text: string };

export type AgentRun = {
  decision: AgentDecision;
  decidedBy: DecidedBy;
  promptVersion: string;
  steps: AgentStep[];
  llmCalls: number;
  usage: TokenUsage;
  durationMs: number;
};

export async function decideOutreach(record: UnifiedRecord, model: ChatModel): Promise<AgentRun> {
  return record.type === "lead"
    ? runAgent(leadProfile, record, model)
    : runAgent(patientProfile, record, model);
}

export async function runAgent<TRecord extends UnifiedRecord, TDecision extends AgentDecision>(
  profile: AgentProfile<TRecord, TDecision>,
  record: TRecord,
  model: ChatModel,
): Promise<AgentRun> {
  const startedAt = Date.now();
  const steps: AgentStep[] = [];
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let llmCalls = 0;

  const finish = (decision: TDecision, decidedBy: DecidedBy): AgentRun => ({
    decision,
    decidedBy,
    promptVersion: profile.promptVersion,
    steps,
    llmCalls,
    usage,
    durationMs: Date.now() - startedAt,
  });

  const ruleDecision = profile.decideWithRules(record);
  if (ruleDecision) return finish(ruleDecision, "rules");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: profile.systemPrompt },
    { role: "user", content: profile.describeRecord(record) },
  ];

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const turn = await model.complete(messages, profile.tools);
      llmCalls++;
      usage.inputTokens += turn.usage.inputTokens;
      usage.outputTokens += turn.usage.outputTokens;

      // Send the assistant message back exactly as we got it. Gemini 3 attaches a thought
      // signature to each tool call and rejects the next request if it is missing.
      messages.push(turn.message as ChatCompletionMessageParam);

      const toolCalls = (turn.message.tool_calls ?? []).filter(
        (call): call is ChatCompletionMessageFunctionToolCall => call.type === "function",
      );

      if (toolCalls.length === 0) {
        steps.push({ kind: "text_reply", text: turn.message.content ?? "" });
        messages.push({
          role: "user",
          content:
            "Reply only with tool calls. Put a draft in check_message and the final decision in " +
            "submit_decision; plain text is not read.",
        });
        continue;
      }

      for (const call of toolCalls) {
        const args = parseArguments(call.function.arguments);

        if (call.function.name === "submit_decision") {
          const check = profile.validateDecision(args, record);
          if (check.ok) return finish(check.decision, "agent");

          steps.push({ kind: "decision_rejected", args, problems: check.problems });
          logger.info(
            { recordId: record.id, problems: check.problems },
            "decision rejected, asking the model to fix it",
          );
          messages.push(toolResult(call.id, { accepted: false, problems: check.problems }));
          continue;
        }

        const result = profile.runTool(call.function.name, args, record);
        steps.push({ kind: "tool_call", tool: call.function.name, args, result });
        messages.push(toolResult(call.id, result));
      }
    }

    return finish(
      profile.fallbackDecision(record, `no valid decision after ${MAX_STEPS} steps`),
      "fallback",
    );
  } catch (error) {
    // The model being unavailable shouldn't lose the record. A person picks it up instead.
    logger.error(
      { recordId: record.id, error: describeError(error) },
      "agent failed, handing record to a human",
    );
    return finish(
      profile.fallbackDecision(record, `LLM error: ${describeError(error)}`),
      "fallback",
    );
  }
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { invalidJson: raw };
  }
}

function toolResult(toolCallId: string, result: unknown): ChatCompletionMessageParam {
  return { role: "tool", tool_call_id: toolCallId, content: JSON.stringify(result) };
}
