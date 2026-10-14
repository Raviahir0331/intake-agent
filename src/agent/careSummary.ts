import type { PatientRecord } from "../records/unifiedRecord";

export type CareSummary = {
  activeConditions: string[];
  chronicConditions: string[];
  riskFlags: string[];
  contactOptions: Array<"sms" | "email">;
};

// Conditions where an automated message is the wrong first move; a clinician should look first.
const HIGH_RISK =
  /neoplasm|cancer|carcinoma|malignant|heart failure|myocardial infarction|stroke|stage [45]\b|end[- ]stage|sepsis|overdose|suicid/i;

const CHRONIC =
  /diabetes|prediabetes|hypertension|asthma|chronic|copd|hyperlipidemia|arthritis|ischemic heart|kidney/i;

/**
 * The clinical view the agent works from. It carries no last name, birth date, address or
 * phone number: the model gets what it needs to decide and nothing more (minimum necessary).
 */
export function buildCareSummary(record: PatientRecord): CareSummary {
  const names = record.patient.conditions.map((condition) => condition.name);
  const contactOptions: CareSummary["contactOptions"] = [];
  if (record.contact.phone) contactOptions.push("sms");
  if (record.contact.email) contactOptions.push("email");

  return {
    activeConditions: names,
    chronicConditions: names.filter((name) => CHRONIC.test(name)),
    riskFlags: names.filter((name) => HIGH_RISK.test(name)),
    contactOptions,
  };
}

/** What the summary points to on its own. Used when the agent can't decide. */
export function likelyCategory(summary: CareSummary) {
  if (summary.riskFlags.length > 0) return "clinical_review";
  if (summary.chronicConditions.length > 0) return "chronic_care_followup";
  return "routine_checkin";
}

export function ageBand(age: number): string {
  if (age >= 90) return "90+";
  const start = Math.floor(age / 10) * 10;
  return `${start}-${start + 9}`;
}
