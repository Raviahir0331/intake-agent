import { z } from "zod";
import type { LeadRow } from "../sources/linkedinCsv";
import { describeIssues } from "../shared/validation";
import { COMPANY_SIZES, type LeadRecord, type NormalizeResult } from "./unifiedRecord";

const requiredText = () => z.string({ error: "is missing" }).min(1, { error: "is empty" });

const leadRowSchema = z.object({
  lead_id: requiredText(),
  full_name: requiredText(),
  job_title: requiredText(),
  company: requiredText(),
  industry: requiredText(),
  company_size: z.enum(COMPANY_SIZES, { error: `must be one of ${COMPANY_SIZES.join(", ")}` }),
  location: z.string().default(""),
  linkedin_headline: z.string().default(""),
  recent_activity: z.string().default(""),
  connection_note: z.string().default(""),
});

const CANADIAN_PROVINCES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

export function normalizeLead(row: LeadRow): NormalizeResult<LeadRecord> {
  const parsed = leadRowSchema.safeParse(row.values);
  if (!parsed.success) return { ok: false, reason: describeIssues(parsed.error) };

  const lead = parsed.data;
  return {
    ok: true,
    record: {
      id: `lead:${lead.lead_id}`,
      type: "lead",
      source: "linkedin_csv",
      sourceRef: row.sourceRef,
      person: splitName(lead.full_name),
      contact: {},
      location: parseLocation(lead.location),
      lead: {
        jobTitle: lead.job_title,
        company: lead.company,
        industry: lead.industry,
        companySize: lead.company_size,
        headline: lead.linkedin_headline,
        recentActivity: lead.recent_activity,
        connectionNote: lead.connection_note,
      },
    },
  };
}

export function splitName(fullName: string) {
  const [firstName = "", ...rest] = fullName.trim().split(/\s+/);
  return { firstName, lastName: rest.join(" "), fullName: fullName.trim() };
}

/**
 * The export only gives "City ST". A trailing two-letter code is a Canadian province if we
 * recognise it, otherwise we assume a US state.
 */
export function parseLocation(text: string): LeadRecord["location"] {
  const match = text.trim().match(/^(.+?)[\s,]+([A-Z]{2})$/);
  if (!match) return text.trim() ? { city: text.trim() } : {};

  const [, city = "", region = ""] = match;
  return { city, region, country: CANADIAN_PROVINCES.has(region) ? "CA" : "US" };
}
