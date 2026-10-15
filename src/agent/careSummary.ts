import type { PatientRecord } from "../records/unifiedRecord";

export type CareSummary = {
  activeConditions: string[];
  chronicConditions: string[];
  riskFlags: string[];
  /** Sensitive history left out of this view. Only the count, so the model knows it exists. */
  sensitiveConditionsOmitted: number;
  contactOptions: Array<"sms" | "email">;
};

// Conditions where an automated message is the wrong first move; a clinician should look first.
const HIGH_RISK =
  /neoplasm|cancer|carcinoma|malignant|heart failure|myocardial infarction|stroke|stage [45]\b|end[- ]stage|sepsis|overdose|suicid/i;

// The patient may not be able to act on (or consent to) a message; the care team decides who to
// contact, often a caregiver.
const COGNITIVE_IMPAIRMENT = /dementia|alzheimer/i;

const CHRONIC =
  /diabet|hypertension|asthma|chronic|copd|emphysema|hyperlipidemia|hypertriglyceridemia|metabolic syndrome|arthritis|ischemic heart|coronary|atrial fibrillation|osteoporosis|kidney|obesity|hypothyroidism|epilepsy/i;

// Reproductive, mental health and substance use history. Outreach never needs it, so it stays out
// of the model's view (minimum necessary). Anything that is also high risk is still flagged above.
const SENSITIVE =
  /miscarriage|pregnan|abortion|depress|anxiety|bipolar|schizo|substance|opioid|alcohol|drug abuse|\bhiv\b/i;

/**
 * The clinical view the agent works from. It carries no last name, birth date, address or
 * phone number: the model gets what it needs to decide and nothing more (minimum necessary).
 */
export function buildCareSummary(record: PatientRecord): CareSummary {
  const names = record.patient.conditions.map((condition) => condition.name);
  const isRisk = (name: string) => HIGH_RISK.test(name) || COGNITIVE_IMPAIRMENT.test(name);
  const shown = names.filter((name) => isRisk(name) || !SENSITIVE.test(name));

  const contactOptions: CareSummary["contactOptions"] = [];
  if (record.contact.phone) contactOptions.push("sms");
  if (record.contact.email) contactOptions.push("email");

  return {
    activeConditions: shown,
    chronicConditions: shown.filter((name) => CHRONIC.test(name)),
    riskFlags: shown.filter(isRisk),
    sensitiveConditionsOmitted: names.length - shown.length,
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
