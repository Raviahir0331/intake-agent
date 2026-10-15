import type {
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { ChatModel } from "../src/llm/chatModel";
import type { LeadRecord, PatientRecord } from "../src/records/unifiedRecord";

export function makeLead(details: Partial<LeadRecord["lead"]> = {}): LeadRecord {
  return {
    id: "lead:L100",
    type: "lead",
    source: "linkedin_csv",
    sourceRef: "test.csv:line 2",
    person: { firstName: "Dana", lastName: "Reyes", fullName: "Dana Reyes" },
    contact: {},
    location: { city: "Austin", region: "TX", country: "US" },
    lead: {
      jobTitle: "Practice Manager",
      company: "Reyes Family Clinic",
      industry: "Healthcare",
      companySize: "11-50",
      headline: "Practice manager",
      recentActivity: "Liked a post about AI receptionists",
      connectionNote: "Cold outreach",
      ...details,
    },
  };
}

export function makePatient(
  overrides: {
    conditions?: string[];
    phone?: string;
    email?: string;
    isDeceased?: boolean;
    age?: number;
  } = {},
): PatientRecord {
  return {
    id: "patient:p-1",
    type: "patient",
    source: "smart_fhir_r4",
    sourceRef: "fixture/Patient/p-1",
    person: { firstName: "Maria", lastName: "Garcia", fullName: "Maria Garcia" },
    contact: { phone: "phone" in overrides ? overrides.phone : "555-0100", email: overrides.email },
    location: {},
    patient: {
      birthDate: "1970-05-01",
      age: overrides.age ?? 56,
      gender: "female",
      isDeceased: overrides.isDeceased ?? false,
      language: "en",
      conditions: (overrides.conditions ?? []).map((name) => ({ name })),
    },
  };
}

/** A model that replies with a fixed list of tool calls, one turn at a time. */
export function scriptedModel(turns: Array<{ tool: string; args: unknown }>) {
  const seen: ChatCompletionMessageParam[][] = [];
  let index = 0;

  const model: ChatModel = {
    name: "test-script",
    async complete(messages) {
      seen.push([...messages]);
      const turn = turns[Math.min(index++, turns.length - 1)];
      if (!turn) throw new Error("script is empty");

      const message: ChatCompletionMessage = {
        role: "assistant",
        content: null,
        refusal: null,
        tool_calls: [
          {
            id: `call-${index}`,
            type: "function",
            function: { name: turn.tool, arguments: JSON.stringify(turn.args) },
          },
        ],
      };
      return { message, usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };

  return { model, seen };
}
