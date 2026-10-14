import { z } from "zod";

/**
 * One shape for everything the agent works on. Fields both sources share live at the top level;
 * source-specific details sit under `lead` or `patient`, and `type` tells them apart.
 */

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;

const personSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string(),
  fullName: z.string().min(1),
});

const contactSchema = z.object({
  email: z.email().optional(),
  phone: z.string().optional(),
});

const locationSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
});

const sharedFields = {
  id: z.string(),
  sourceRef: z.string(),
  person: personSchema,
  contact: contactSchema,
  location: locationSchema,
};

export const leadRecordSchema = z.object({
  ...sharedFields,
  type: z.literal("lead"),
  source: z.literal("linkedin_csv"),
  lead: z.object({
    jobTitle: z.string(),
    company: z.string(),
    industry: z.string(),
    companySize: z.enum(COMPANY_SIZES),
    headline: z.string(),
    recentActivity: z.string(),
    connectionNote: z.string(),
  }),
});

export const patientRecordSchema = z.object({
  ...sharedFields,
  type: z.literal("patient"),
  source: z.literal("smart_fhir_r4"),
  patient: z.object({
    birthDate: z.string(),
    age: z.number().int().min(0),
    gender: z.enum(["male", "female", "other", "unknown"]),
    isDeceased: z.boolean(),
    language: z.string().optional(),
    // Only active, clinically relevant conditions are kept. See normalizePatient.
    conditions: z.array(z.object({ code: z.string().optional(), name: z.string() })),
  }),
});

export const unifiedRecordSchema = z.discriminatedUnion("type", [
  leadRecordSchema,
  patientRecordSchema,
]);

export type LeadRecord = z.infer<typeof leadRecordSchema>;
export type PatientRecord = z.infer<typeof patientRecordSchema>;
export type UnifiedRecord = z.infer<typeof unifiedRecordSchema>;

/** A record we could not take through the pipeline, and why. Nothing is dropped silently. */
export type RejectedRecord = {
  sourceRef: string;
  stage: "ingest" | "agent" | "delivery";
  reason: string;
};

export type NormalizeResult<T> = { ok: true; record: T } | { ok: false; reason: string };
