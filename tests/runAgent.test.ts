import { describe, expect, it } from "vitest";
import { decideOutreach } from "../src/agent/runAgent";
import type { ChatModel } from "../src/llm/chatModel";
import { makeLead, makePatient, scriptedModel } from "./helpers";

const validLeadDecision = {
  category: "warm",
  channel: "linkedin_connection_request",
  escalate: false,
  tone: "friendly",
  language: "en",
  message: "Hi Dana, saw your note on AI receptionists. Happy to connect and compare notes?",
  rationale: "Engaged with a relevant post and manages a mid-size clinic.",
  confidence: 0.7,
};

describe("agent loop", () => {
  it("sends rejected decisions back to the model and accepts the corrected one", async () => {
    const { model, seen } = scriptedModel([
      { tool: "get_lead_score", args: { lead_id: "lead:L100" } },
      // Not connected yet, so a direct message is not allowed.
      { tool: "submit_decision", args: { ...validLeadDecision, channel: "linkedin_message" } },
      { tool: "submit_decision", args: validLeadDecision },
    ]);

    const run = await decideOutreach(makeLead(), model);

    expect(run.decidedBy).toBe("agent");
    expect(run.decision.channel).toBe("linkedin_connection_request");
    expect(run.llmCalls).toBe(3);
    expect(run.usage).toEqual({ inputTokens: 300, outputTokens: 60 });
    expect(run.steps.map((step) => step.kind)).toEqual(["tool_call", "decision_rejected"]);

    // The model saw why it was rejected before its third attempt.
    const lastPrompt = JSON.stringify(seen[2]);
    expect(lastPrompt).toContain("use linkedin_connection_request");
  });

  it("hands the record to a human when the model never produces a valid decision", async () => {
    const { model } = scriptedModel([{ tool: "submit_decision", args: { category: "maybe" } }]);

    const run = await decideOutreach(makeLead(), model);

    expect(run.decidedBy).toBe("fallback");
    expect(run.decision.channel).toBe("sales_handoff");
    expect(run.decision.escalate).toBe(true);
    expect(run.llmCalls).toBe(6);
  });

  it("falls back instead of crashing when the LLM is unavailable", async () => {
    const brokenModel: ChatModel = {
      name: "down",
      complete: async () => {
        throw new Error("503 Service Unavailable");
      },
    };

    const run = await decideOutreach(makePatient({ conditions: ["Hypertension"] }), brokenModel);

    expect(run.decidedBy).toBe("fallback");
    expect(run.decision.channel).toBe("care_team_review");
    expect(run.decision.category).toBe("chronic_care_followup");
  });

  it("skips the LLM for inbound requests and deceased patients", async () => {
    const { model, seen } = scriptedModel([]);

    const hotLead = await decideOutreach(
      makeLead({ connectionNote: "Requested a demo via website form" }),
      model,
    );
    const deceased = await decideOutreach(makePatient({ isDeceased: true }), model);

    expect(hotLead.decidedBy).toBe("rules");
    expect(hotLead.decision.channel).toBe("sales_handoff");
    expect(deceased.decision.category).toBe("do_not_contact");
    expect(seen).toHaveLength(0);
  });

  it("won't let the model message a patient who has a risk flag", async () => {
    const { model } = scriptedModel([
      {
        tool: "submit_decision",
        args: {
          category: "chronic_care_followup",
          channel: "sms",
          escalate: false,
          tone: "warm",
          language: "en",
          message: "Hi Maria, time to book a visit. Reply STOP to opt out.",
          rationale: "Has chronic conditions that need follow-up.",
          confidence: 0.8,
        },
      },
    ]);

    const run = await decideOutreach(
      makePatient({ conditions: ["Malignant neoplasm of breast"] }),
      model,
    );

    expect(run.decidedBy).toBe("fallback");
    expect(run.decision.category).toBe("clinical_review");
    expect(run.steps[0]).toMatchObject({ kind: "decision_rejected" });
  });
});
