import { z } from "zod";
import type { PatientBundle } from "../sources/fhirPatients";
import { describeIssues } from "../shared/validation";
import type { NormalizeResult, PatientRecord } from "./unifiedRecord";

// Only the parts of FHIR R4 Patient and Condition this pipeline reads.
const humanNameSchema = z.object({
  use: z.string().optional(),
  given: z.array(z.string()).optional(),
  family: z.string().optional(),
});

const fhirPatientSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string().min(1),
  name: z.array(humanNameSchema, { error: "is missing" }).min(1, { error: "is empty" }),
  gender: z.enum(["male", "female", "other", "unknown"]).default("unknown"),
  // FHIR allows partial dates (YYYY or YYYY-MM).
  birthDate: z
    .string({ error: "is missing" })
    .regex(/^\d{4}(-\d{2}){0,2}$/, { error: "is not a FHIR date (YYYY, YYYY-MM or YYYY-MM-DD)" }),
  deceasedBoolean: z.boolean().optional(),
  deceasedDateTime: z.string().optional(),
  telecom: z
    .array(z.object({ system: z.string().optional(), value: z.string().optional() }))
    .default([]),
  address: z
    .array(
      z.object({
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
      }),
    )
    .default([]),
  communication: z
    .array(
      z.object({
        language: z.object({
          coding: z.array(z.object({ code: z.string().optional() })).optional(),
        }),
        preferred: z.boolean().optional(),
      }),
    )
    .default([]),
});

const fhirConditionSchema = z.object({
  resourceType: z.literal("Condition"),
  code: z
    .object({
      text: z.string().optional(),
      coding: z
        .array(z.object({ code: z.string().optional(), display: z.string().optional() }))
        .optional(),
    })
    .optional(),
  clinicalStatus: z
    .object({ coding: z.array(z.object({ code: z.string().optional() })).optional() })
    .optional(),
});

type FhirPatient = z.infer<typeof fhirPatientSchema>;

const ACTIVE_STATUSES = new Set(["active", "recurrence", "relapse"]);

// Synthea records social history as Conditions tagged "(finding)" or "(situation)", for example
// "Full-time employment (finding)". They say nothing useful about care outreach.
const NON_CLINICAL_TAG = /\((finding|situation|person|social concept)\)\s*$/i;

export function normalizePatient(
  bundle: PatientBundle,
  fhirBaseUrl: string,
): NormalizeResult<PatientRecord> {
  const parsed = fhirPatientSchema.safeParse(bundle.patient);
  if (!parsed.success) return { ok: false, reason: describeIssues(parsed.error) };

  const patient = parsed.data;
  const name = patient.name.find((n) => n.use === "official") ?? patient.name[0];
  const firstName = cleanSyntheaName(name?.given?.join(" ") ?? "");
  const lastName = cleanSyntheaName(name?.family ?? "");

  if (!firstName) return { ok: false, reason: "name: has no given name" };

  const address = patient.address[0];
  return {
    ok: true,
    record: {
      id: `patient:${patient.id}`,
      type: "patient",
      source: "smart_fhir_r4",
      sourceRef: `${fhirBaseUrl}/Patient/${patient.id}`,
      person: { firstName, lastName, fullName: `${firstName} ${lastName}`.trim() },
      contact: {
        phone: patient.telecom.find((t) => t.system === "phone")?.value,
        email: validEmailOrUndefined(patient.telecom.find((t) => t.system === "email")?.value),
      },
      location: { city: address?.city, region: address?.state, country: address?.country },
      patient: {
        birthDate: patient.birthDate,
        age: ageFromBirthDate(patient.birthDate),
        gender: patient.gender,
        isDeceased: patient.deceasedBoolean === true || patient.deceasedDateTime !== undefined,
        language: preferredLanguage(patient.communication),
        conditions: activeConditions(bundle.conditions),
      },
    },
  };
}

/** Synthea appends digits to generated names ("Aaron697") to keep them unique. */
export function cleanSyntheaName(name: string): string {
  return name.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
}

export function ageFromBirthDate(birthDate: string, today = new Date()): number {
  const [year = 0, month = 1, day = 1] = birthDate.split("-").map(Number);
  let age = today.getFullYear() - year;
  const birthdayPassed =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!birthdayPassed) age -= 1;
  return Math.max(age, 0);
}

function activeConditions(rawConditions: unknown[]): PatientRecord["patient"]["conditions"] {
  const seen = new Set<string>();
  const conditions: PatientRecord["patient"]["conditions"] = [];

  for (const raw of rawConditions) {
    const parsed = fhirConditionSchema.safeParse(raw);
    if (!parsed.success) continue; // one broken Condition shouldn't cost us the whole patient

    const condition = parsed.data;
    // A Condition without clinicalStatus is treated as active so it still gets reviewed.
    const status = condition.clinicalStatus?.coding?.[0]?.code ?? "active";
    const label = condition.code?.text ?? condition.code?.coding?.[0]?.display;

    if (!label || !ACTIVE_STATUSES.has(status) || NON_CLINICAL_TAG.test(label)) continue;

    const name = label.replace(/\s*\(disorder\)\s*$/i, "");
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    conditions.push({ code: condition.code?.coding?.[0]?.code, name });
  }

  return conditions;
}

function preferredLanguage(communication: FhirPatient["communication"]) {
  const entry = communication.find((c) => c.preferred) ?? communication[0];
  const code = entry?.language.coding?.[0]?.code;
  return code ? code.slice(0, 2).toLowerCase() : undefined;
}

function validEmailOrUndefined(value: string | undefined) {
  return value && z.email().safeParse(value).success ? value : undefined;
}
