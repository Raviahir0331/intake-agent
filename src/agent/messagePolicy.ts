import type { LeadRecord, PatientRecord } from "../records/unifiedRecord";
import type { LeadDecision, PatientDecision } from "./decision";

/**
 * Hard rules every message must pass before it can leave the system. The agent can call these
 * through the check_message tool while drafting, and the same rules run again on the final
 * decision, so nothing depends on the model choosing to check.
 */

const LINKEDIN_CONNECTION_NOTE_LIMIT = 300;
const LINKEDIN_MESSAGE_LIMIT = 800;
const SMS_LIMIT = 320;

const PLACEHOLDER = /\[[^\]]*\]|\{\{|\}\}/;
const MADE_UP_NUMBERS = /\d+(\.\d+)?\s?%|\b\d+x\b/i;

export function checkLeadMessage(
  lead: LeadRecord,
  channel: LeadDecision["channel"],
  message: string,
): string[] {
  const problems = commonProblems(message);
  // A handoff message is an internal brief for sales, not something the lead reads.
  if (channel === "sales_handoff") return problems;

  if (!mentionsName(message, lead.person.firstName)) {
    problems.push(`address the lead by first name (${lead.person.firstName})`);
  }
  if (
    channel === "linkedin_connection_request" &&
    message.length > LINKEDIN_CONNECTION_NOTE_LIMIT
  ) {
    problems.push(
      `LinkedIn connection notes are limited to ${LINKEDIN_CONNECTION_NOTE_LIMIT} characters (this one is ${message.length})`,
    );
  }
  if (channel === "linkedin_message" && message.length > LINKEDIN_MESSAGE_LIMIT) {
    problems.push(`keep LinkedIn messages under ${LINKEDIN_MESSAGE_LIMIT} characters`);
  }
  if (MADE_UP_NUMBERS.test(message)) {
    problems.push("remove statistics or percentages; we can't back them up for this lead");
  }
  if (/guarantee/i.test(message)) problems.push("don't promise guaranteed results");

  return problems;
}

export function checkPatientMessage(
  patient: PatientRecord,
  channel: PatientDecision["channel"],
  message: string,
): string[] {
  const problems = commonProblems(message);
  // These go to staff, not the patient.
  if (channel === "care_team_review" || channel === "none") return problems;

  if (!mentionsName(message, patient.person.firstName)) {
    problems.push(`address the patient by first name (${patient.person.firstName})`);
  }

  // Texts and emails can be read by whoever holds the phone, so they never name a condition.
  const leaked = conditionWords(patient).filter((word) => message.toLowerCase().includes(word));
  if (leaked.length > 0 || /diagnos/i.test(message)) {
    problems.push(
      `don't mention diagnoses or conditions in patient messages (found: ${leaked.join(", ") || "diagnosis"})`,
    );
  }

  if (channel === "sms") {
    if (message.length > SMS_LIMIT) problems.push(`SMS must be ${SMS_LIMIT} characters or less`);
    if (!/\bSTOP\b/.test(message)) {
      problems.push('SMS must include opt-out text, e.g. "Reply STOP to opt out."');
    }
  }

  return problems;
}

function commonProblems(message: string): string[] {
  const problems: string[] = [];
  if (!message.trim()) problems.push("message is empty");
  if (PLACEHOLDER.test(message)) {
    problems.push("message still contains a placeholder like [Name] or {{...}}");
  }
  return problems;
}

function mentionsName(message: string, firstName: string): boolean {
  return message.toLowerCase().includes(firstName.toLowerCase());
}

// Generic words that appear in condition names but give nothing away on their own.
const GENERIC_WORDS = new Set(["chronic", "disease", "disorder", "acute", "stage", "syndrome"]);

function conditionWords(patient: PatientRecord): string[] {
  const words = patient.patient.conditions.flatMap((condition) =>
    condition.name.toLowerCase().split(/[^a-z]+/),
  );
  return [...new Set(words)].filter((word) => word.length >= 5 && !GENERIC_WORDS.has(word));
}
