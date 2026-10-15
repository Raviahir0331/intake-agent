import { describe, expect, it } from "vitest";
import { buildCareSummary, likelyCategory } from "../src/agent/careSummary";
import { patientProfile } from "../src/agent/patientProfile";
import { makePatient } from "./helpers";

describe("care summary", () => {
  it("recognises the chronic conditions Synthea generates most often", () => {
    const conditions = [
      "Coronary Heart Disease",
      "Atrial Fibrillation",
      "Osteoporosis",
      "Pulmonary emphysema",
      "Metabolic syndrome X",
      "Hypertriglyceridemia",
      "Diabetic renal disease",
    ];
    const summary = buildCareSummary(makePatient({ conditions }));
    expect(summary.chronicConditions).toEqual(conditions);
    expect(summary.riskFlags).toEqual([]);
    expect(likelyCategory(summary)).toBe("chronic_care_followup");
  });

  it("flags dementia for the care team", () => {
    const summary = buildCareSummary(makePatient({ conditions: ["Alzheimer's disease"] }));
    expect(summary.riskFlags).toEqual(["Alzheimer's disease"]);
    expect(likelyCategory(summary)).toBe("clinical_review");
  });

  it("leaves sensitive history out of the model's view but keeps high-risk entries", () => {
    const summary = buildCareSummary(
      makePatient({ conditions: ["Miscarriage in first trimester", "Drug overdose", "Anemia"] }),
    );
    expect(summary.activeConditions).toEqual(["Drug overdose", "Anemia"]);
    expect(summary.riskFlags).toEqual(["Drug overdose"]);
    expect(summary.sensitiveConditionsOmitted).toBe(1);
  });
});

describe("patient rules", () => {
  it("routes a minor to the front desk to contact a guardian", () => {
    const decision = patientProfile.decideWithRules(makePatient({ age: 15 }));
    expect(decision).toMatchObject({ channel: "care_team_review", escalate: true });
    expect(decision?.message).toMatch(/guardian/);
  });

  it("routes patients aged 90+ to a phone call, keeping the clinical category", () => {
    const decision = patientProfile.decideWithRules(
      makePatient({ age: 94, conditions: ["Hypertension"] }),
    );
    expect(decision).toMatchObject({
      category: "chronic_care_followup",
      channel: "care_team_review",
      escalate: true,
    });
    expect(decision?.message).toMatch(/call/);
  });

  it("leaves adults under 90 to the agent", () => {
    expect(patientProfile.decideWithRules(makePatient({ age: 18 }))).toBeNull();
    expect(patientProfile.decideWithRules(makePatient({ age: 89 }))).toBeNull();
  });
});
