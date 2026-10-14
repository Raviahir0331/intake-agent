import { describe, expect, it } from "vitest";
import { normalizeLead, parseLocation, splitName } from "../src/records/normalizeLead";
import { leadRecordSchema } from "../src/records/unifiedRecord";

const validRow = {
  lead_id: "L004",
  full_name: "James O'Connell",
  job_title: "Founder",
  company: "O'Connell Med Spa",
  industry: "Medspa",
  company_size: "1-10",
  location: "Miami FL",
  linkedin_headline: "Founder, medspa entrepreneur, ex-nurse",
  recent_activity: "Posted about struggling with lead follow-up speed",
  connection_note: "Cold outreach, no prior interaction",
};

describe("normalizeLead", () => {
  it("turns a CSV row into a unified lead record", () => {
    const result = normalizeLead({ values: validRow, sourceRef: "mock_leads.csv:line 5" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(leadRecordSchema.safeParse(result.record).success).toBe(true);
    expect(result.record.id).toBe("lead:L004");
    expect(result.record.person).toEqual({
      firstName: "James",
      lastName: "O'Connell",
      fullName: "James O'Connell",
    });
    expect(result.record.location).toEqual({ city: "Miami", region: "FL", country: "US" });
  });

  it("rejects a row with an empty name and says which column", () => {
    const result = normalizeLead({ values: { ...validRow, full_name: "" }, sourceRef: "x" });
    expect(result).toEqual({ ok: false, reason: "full_name: is empty" });
  });

  it("rejects an unknown company size", () => {
    const result = normalizeLead({ values: { ...validRow, company_size: "lots" }, sourceRef: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("company_size");
  });

  it("rejects a truncated row instead of throwing", () => {
    const result = normalizeLead({
      values: { lead_id: "L021", full_name: "Peter Vance", job_title: "Founder" },
      sourceRef: "x",
    });
    expect(result.ok).toBe(false);
  });
});

describe("parseLocation", () => {
  it("recognises Canadian provinces", () => {
    expect(parseLocation("Montreal QC")).toEqual({ city: "Montreal", region: "QC", country: "CA" });
  });

  it("keeps multi-word cities together", () => {
    expect(parseLocation("San Antonio TX")).toEqual({
      city: "San Antonio",
      region: "TX",
      country: "US",
    });
  });

  it("falls back to city only when there is no region code", () => {
    expect(parseLocation("Remote")).toEqual({ city: "Remote" });
    expect(parseLocation("")).toEqual({});
  });
});

describe("splitName", () => {
  it("puts everything after the first word in the last name", () => {
    expect(splitName("Mary Ann van der Berg").lastName).toBe("Ann van der Berg");
  });
});
