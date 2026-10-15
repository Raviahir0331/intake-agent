import { z } from "zod";
import type { PatientRecord } from "../records/unifiedRecord";
import { issueMessages } from "../shared/validation";
import {
  checkMessageTool,
  defineTool,
  submitDecisionTool,
  type AgentProfile,
} from "./agentProfile";
import { ageBand, buildCareSummary, likelyCategory, type CareSummary } from "./careSummary";
import {
  PATIENT_CATEGORIES,
  PATIENT_CHANNELS,
  patientDecisionSchema,
  type PatientDecision,
} from "./decision";
import { checkPatientMessage } from "./messagePolicy";
import { PATIENT_PROMPT_VERSION, PATIENT_SYSTEM_PROMPT } from "./prompts/patientPrompt";

const checkMessageArgs = z.object({ channel: z.enum(PATIENT_CHANNELS), message: z.string() });

const MINOR_UNDER = 18;
const PHONE_CALL_FROM = 90;

/** A person at the clinic makes this contact. The category still reflects the clinical picture. */
function frontDeskHandoff(
  summary: CareSummary,
  message: string,
  rationale: string,
): PatientDecision {
  return {
    category: likelyCategory(summary),
    channel: "care_team_review",
    escalate: true,
    tone: "internal",
    language: "en",
    message,
    rationale,
    confidence: 1,
  };
}

export const patientProfile: AgentProfile<PatientRecord, PatientDecision> = {
  promptVersion: PATIENT_PROMPT_VERSION,
  systemPrompt: PATIENT_SYSTEM_PROMPT,
  tools: [
    defineTool(
      "get_care_summary",
      "Active conditions, risk flags and available contact channels for a patient.",
      { patient_id: { type: "string", description: "The record id from the request" } },
    ),
    checkMessageTool(PATIENT_CHANNELS),
    submitDecisionTool(PATIENT_CATEGORIES, PATIENT_CHANNELS),
  ],

  decideWithRules(record) {
    if (record.patient.isDeceased) {
      return {
        category: "do_not_contact",
        channel: "none",
        escalate: false,
        tone: "internal",
        language: "en",
        message: "Patient is recorded as deceased. Suppress all outreach.",
        rationale: "Rule: deceased patients are never contacted.",
        confidence: 1,
      };
    }

    const summary = buildCareSummary(record);
    if (summary.contactOptions.length === 0) {
      return {
        category: "routine_checkin",
        channel: "care_team_review",
        escalate: true,
        tone: "internal",
        language: "en",
        message: "No phone or email on file. Ask the front desk to update contact details.",
        rationale: "Rule: there is no channel we can use to reach this patient.",
        confidence: 1,
      };
    }

    const { age } = record.patient;
    if (age < MINOR_UNDER) {
      return frontDeskHandoff(
        summary,
        `Patient is ${age}. Contact the parent or guardian on file, not the patient.`,
        `Rule: patients under ${MINOR_UNDER} are contacted through a parent or guardian.`,
      );
    }
    if (age >= PHONE_CALL_FROM) {
      return frontDeskHandoff(
        summary,
        `Patient is ${age}. Front desk to call rather than text, and include any caregiver on file.`,
        `Rule: patients aged ${PHONE_CALL_FROM}+ get a phone call from the front desk, not an automated text.`,
      );
    }

    return null;
  },

  describeRecord(record) {
    const { person, patient } = record;
    return [
      `Patient to review (record id: ${record.id})`,
      `First name: ${person.firstName}`,
      `Age band: ${ageBand(patient.age)}`,
      `Gender: ${patient.gender}`,
      `Preferred language: ${patient.language ?? "en"}`,
    ].join("\n");
  },

  runTool(name, args, record) {
    if (name === "get_care_summary") {
      const requestedId = (args as { patient_id?: unknown } | undefined)?.patient_id;
      if (requestedId !== record.id) return { error: `Unknown patient id. Use ${record.id}.` };
      return buildCareSummary(record);
    }

    if (name === "check_message") {
      const parsed = checkMessageArgs.safeParse(args);
      if (!parsed.success) return { error: issueMessages(parsed.error) };
      const problems = checkPatientMessage(record, parsed.data.channel, parsed.data.message);
      return { ok: problems.length === 0, problems, characters: parsed.data.message.length };
    }

    return { error: `Unknown tool: ${name}` };
  },

  validateDecision(args, record) {
    const parsed = patientDecisionSchema.safeParse(args);
    if (!parsed.success) return { ok: false, problems: issueMessages(parsed.error) };

    const decision = parsed.data;
    const summary = buildCareSummary(record);
    const problems: string[] = [];

    if (summary.riskFlags.length > 0) {
      if (decision.category !== "clinical_review") {
        problems.push(
          `risk flags present (${summary.riskFlags.join(", ")}): category must be clinical_review`,
        );
      }
      if (decision.channel !== "care_team_review" || !decision.escalate) {
        problems.push(
          "clinical_review goes to the care team: channel care_team_review, escalate true",
        );
      }
    }
    if (decision.channel === "sms" && !summary.contactOptions.includes("sms")) {
      problems.push("patient has no phone number; sms is not available");
    }
    if (decision.channel === "email" && !summary.contactOptions.includes("email")) {
      problems.push("patient has no email address; email is not available");
    }
    if (decision.channel === "email" && !decision.subject) {
      problems.push("emails need a subject line");
    }
    problems.push(...checkPatientMessage(record, decision.channel, decision.message));

    return problems.length ? { ok: false, problems } : { ok: true, decision };
  },

  fallbackDecision(record, reason) {
    return {
      category: likelyCategory(buildCareSummary(record)),
      channel: "care_team_review",
      escalate: true,
      tone: "internal",
      language: "en",
      message: `Agent could not finish this patient (${reason}). Please review manually.`,
      rationale: `Fallback: ${reason}`,
      confidence: 0,
    };
  },
};
