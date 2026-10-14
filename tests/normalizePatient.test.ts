import { describe, expect, it } from "vitest";
import {
  ageFromBirthDate,
  cleanSyntheaName,
  normalizePatient,
} from "../src/records/normalizePatient";
import { patientRecordSchema } from "../src/records/unifiedRecord";

const condition = (display: string, status = "active") => ({
  resourceType: "Condition",
  clinicalStatus: { coding: [{ code: status }] },
  code: { coding: [{ code: "123", display }], text: display },
});

const patient = {
  resourceType: "Patient",
  id: "abc-123",
  name: [
    { use: "maiden", given: ["Old"], family: "Name" },
    { use: "official", given: ["Aaron697"], family: "Brekke496" },
  ],
  gender: "male",
  birthDate: "1961-03-14",
  telecom: [
    { system: "phone", value: "555-123-4567" },
    { system: "email", value: "not-an-email" },
  ],
  address: [{ city: "Boston", state: "Massachusetts", country: "US" }],
  communication: [{ language: { coding: [{ code: "en-US" }] } }],
};

describe("normalizePatient", () => {
  it("maps a FHIR Patient and its Conditions to a unified record", () => {
    const result = normalizePatient(
      {
        patient,
        conditions: [
          condition("Hypertension"),
          condition("Diabetes mellitus type 2 (disorder)"),
          condition("Acute viral pharyngitis (disorder)", "resolved"),
          condition("Full-time employment (finding)"),
          { resourceType: "Condition", code: "broken" },
        ],
      },
      "https://fhir.test",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const record = result.record;

    expect(patientRecordSchema.safeParse(record).success).toBe(true);
    expect(record.person.fullName).toBe("Aaron Brekke"); // official name, digits removed
    expect(record.contact).toEqual({ phone: "555-123-4567", email: undefined });
    expect(record.patient.language).toBe("en");
    // resolved conditions, social findings and malformed entries are left out
    expect(record.patient.conditions.map((c) => c.name)).toEqual([
      "Hypertension",
      "Diabetes mellitus type 2",
    ]);
  });

  it("flags deceased patients", () => {
    const result = normalizePatient(
      { patient: { ...patient, deceasedDateTime: "2024-01-09T08:15:00Z" }, conditions: [] },
      "x",
    );
    expect(result.ok && result.record.patient.isDeceased).toBe(true);
  });

  it("rejects a Patient with no name and a non-FHIR birth date", () => {
    const result = normalizePatient(
      {
        patient: { resourceType: "Patient", id: "broken", birthDate: "03/14/1980" },
        conditions: [],
      },
      "x",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("name");
      expect(result.reason).toContain("birthDate");
    }
  });
});

describe("helpers", () => {
  it("strips Synthea's numeric suffixes", () => {
    expect(cleanSyntheaName("Aaron697")).toBe("Aaron");
    expect(cleanSyntheaName("Mary12 Ann34")).toBe("Mary Ann");
  });

  it("calculates age from full and partial FHIR dates", () => {
    const today = new Date(2026, 9, 14); // 14 Oct 2026
    expect(ageFromBirthDate("1961-03-14", today)).toBe(65);
    expect(ageFromBirthDate("1961-12-01", today)).toBe(64);
    expect(ageFromBirthDate("1961", today)).toBe(65);
  });
});
