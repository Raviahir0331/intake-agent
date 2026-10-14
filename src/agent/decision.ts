import { z } from "zod";

export const LEAD_CATEGORIES = ["hot", "warm", "cold"] as const;
export const LEAD_CHANNELS = [
  "linkedin_connection_request",
  "linkedin_message",
  "sales_handoff",
] as const;

export const PATIENT_CATEGORIES = [
  "routine_checkin",
  "chronic_care_followup",
  "clinical_review",
  "do_not_contact",
] as const;
export const PATIENT_CHANNELS = ["sms", "email", "care_team_review", "none"] as const;

export const LANGUAGES = ["en", "fr", "es"] as const;

const sharedDecisionFields = {
  escalate: z.boolean(),
  tone: z.string().min(1).max(40),
  language: z.enum(LANGUAGES),
  subject: z.string().max(120).nullish(),
  // For a handoff this is a short brief for the human who picks it up, not outreach copy.
  message: z.string().min(1).max(1500),
  rationale: z.string().min(10).max(500),
  confidence: z.number().min(0).max(1),
};

export const leadDecisionSchema = z.object({
  ...sharedDecisionFields,
  category: z.enum(LEAD_CATEGORIES),
  channel: z.enum(LEAD_CHANNELS),
});

export const patientDecisionSchema = z.object({
  ...sharedDecisionFields,
  category: z.enum(PATIENT_CATEGORIES),
  channel: z.enum(PATIENT_CHANNELS),
});

export type LeadDecision = z.infer<typeof leadDecisionSchema>;
export type PatientDecision = z.infer<typeof patientDecisionSchema>;
export type AgentDecision = LeadDecision | PatientDecision;

/** Who made the call: a hard rule, the LLM agent, or the safety fallback when the agent gave up. */
export type DecidedBy = "rules" | "agent" | "fallback";
