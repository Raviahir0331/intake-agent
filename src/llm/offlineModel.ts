import type {
  ChatCompletionFunctionTool,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { CareSummary } from "../agent/careSummary";
import type { LeadScore } from "../agent/leadScoring";
import type { ChatModel } from "./chatModel";

/**
 * A scripted stand-in for the LLM, used by `--offline` and the integration test. It follows the
 * same tool protocol as a real model (look up context, check the draft, submit) with fixed
 * templates, so the whole pipeline can run without an API key or network access.
 *
 * It is plumbing for demos and tests, not a replacement for the real agent's judgment.
 */
export function createOfflineModel(): ChatModel {
  let callCounter = 0;

  return {
    name: "offline-scripted",
    async complete(messages, tools) {
      const brief = readBrief(messages);
      const toolResults = messages
        .filter((message) => message.role === "tool")
        .map((message) => JSON.parse(String(message.content)) as Record<string, unknown>);

      const callTool = (name: string, args: Record<string, unknown>) =>
        toolCallMessage(`offline-call-${++callCounter}`, name, args);

      // Step 1: look up context with whichever get_* tool this profile offers.
      const lookupTool = tools.find((tool) => tool.function.name.startsWith("get_"));
      if (toolResults.length === 0 && lookupTool) {
        return {
          message: callTool(lookupTool.function.name, { [firstParam(lookupTool)]: brief.recordId }),
          usage: noTokens,
        };
      }

      const context = toolResults[0] ?? {};
      const decision = brief.isLead
        ? draftLeadDecision(brief, context)
        : draftPatientDecision(brief, context);

      // Step 2: check the draft once. Step 3: submit, escalating if the check found problems.
      if (toolResults.length === 1) {
        return {
          message: callTool("check_message", {
            channel: decision.channel,
            message: decision.message,
          }),
          usage: noTokens,
        };
      }

      const check = toolResults[1] ?? {};
      if (check.ok === false) {
        Object.assign(decision, {
          channel: brief.isLead ? "sales_handoff" : "care_team_review",
          escalate: true,
          message: `Draft failed checks: ${JSON.stringify(check.problems)}. Needs a human.`,
        });
      }
      return { message: callTool("submit_decision", decision), usage: noTokens };
    },
  };
}

const noTokens = { inputTokens: 0, outputTokens: 0 };

type Brief = {
  recordId: string;
  isLead: boolean;
  firstName: string;
  company: string;
  connected: boolean;
  language: string;
};

function readBrief(messages: ChatCompletionMessageParam[]): Brief {
  const text = String(messages.find((message) => message.role === "user")?.content ?? "");
  const field = (label: string) =>
    text.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1]?.trim() ?? "";

  return {
    recordId: text.match(/record id: ([^)]+)\)/)?.[1] ?? "",
    isLead: text.startsWith("Lead"),
    firstName: field("First name") || field("Name").split(" ")[0] || "there",
    company: field("Role").split(" at ").slice(1).join(" at "),
    connected: field("Already connected on LinkedIn") === "yes",
    language: field("Preferred language") || "en",
  };
}

function draftLeadDecision(brief: Brief, score: Partial<LeadScore>) {
  const tier = score.suggestedTier === "warm" ? "warm" : "cold";
  const message =
    tier === "warm"
      ? `Hi ${brief.firstName}, thanks for engaging with posts on clinic front-desk workload. ` +
        `We help practices like ${brief.company} answer every call and book visits with an AI ` +
        `receptionist. Open to a short chat next week?`
      : `Hi ${brief.firstName}, I work with clinic teams on call handling and booking. ` +
        `Happy to connect and share what's working for practices like ${brief.company}.`;

  return {
    category: tier,
    channel: brief.connected ? "linkedin_message" : "linkedin_connection_request",
    escalate: false,
    tone: tier === "warm" ? "consultative" : "light",
    language: "en",
    message,
    rationale: `Offline template: rule score ${score.score ?? "n/a"} suggests ${tier}.`,
    confidence: 0.5,
  };
}

function draftPatientDecision(brief: Brief, summary: Partial<CareSummary>) {
  const riskFlags = summary.riskFlags ?? [];
  const chronic = summary.chronicConditions ?? [];
  const options = summary.contactOptions ?? [];

  if (riskFlags.length > 0) {
    return {
      category: "clinical_review",
      channel: "care_team_review",
      escalate: true,
      tone: "internal",
      language: "en",
      message: `Risk flags: ${riskFlags.join(", ")}. Please review before any outreach.`,
      rationale: "Offline template: risk flags present, so a clinician reviews first.",
      confidence: 0.9,
    };
  }

  const followUp = chronic.length > 0;
  const spanish = brief.language === "es";
  const message = spanish
    ? `Hola ${brief.firstName}, le escribe su equipo de atención. Es momento de agendar ` +
      `${followUp ? "una cita de seguimiento" : "un chequeo de rutina"}. ` +
      `Responda SI y le llamaremos para coordinar. Responda STOP para no recibir mensajes.`
    : `Hi ${brief.firstName}, this is your care team. It's time to book ` +
      `${followUp ? "a follow-up visit" : "a routine check-up"}. ` +
      `Reply YES and we'll call you to find a time. Reply STOP to opt out.`;

  const channel = options.includes("sms") ? "sms" : "email";
  return {
    category: followUp ? "chronic_care_followup" : "routine_checkin",
    channel,
    escalate: false,
    tone: "warm",
    language: spanish ? "es" : "en",
    subject:
      channel === "email"
        ? spanish
          ? "Es momento de su visita"
          : "Time to book your visit"
        : undefined,
    message,
    rationale: `Offline template: ${followUp ? "chronic conditions need regular follow-up" : "no active issues"}.`,
    confidence: 0.6,
  };
}

function toolCallMessage(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ChatCompletionMessage {
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  };
}

function firstParam(tool: ChatCompletionFunctionTool): string {
  const properties = (tool.function.parameters?.properties ?? {}) as Record<string, unknown>;
  return Object.keys(properties)[0] ?? "id";
}
