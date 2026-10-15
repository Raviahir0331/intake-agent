import { describe, expect, it } from "vitest";
import { checkLeadMessage, checkPatientMessage } from "../src/agent/messagePolicy";
import { makeLead, makePatient } from "./helpers";

describe("lead message policy", () => {
  const lead = makeLead();

  it("passes a short, personal connection request", () => {
    const message = "Hi Dana, saw you liked the post on AI receptionists. Open to connecting?";
    expect(checkLeadMessage(lead, "linkedin_connection_request", message)).toEqual([]);
  });

  it("rejects made-up statistics, placeholders and missing names", () => {
    const problems = checkLeadMessage(
      lead,
      "linkedin_message",
      "Hi [Name], we cut no-shows by 40%!",
    );
    expect(problems.join(" ")).toMatch(/first name/);
    expect(problems.join(" ")).toMatch(/placeholder/);
    expect(problems.join(" ")).toMatch(/statistics/);
  });

  it("enforces LinkedIn's 300 character limit on connection notes", () => {
    const problems = checkLeadMessage(
      lead,
      "linkedin_connection_request",
      `Hi Dana, ${"a".repeat(300)}`,
    );
    expect(problems.join(" ")).toMatch(/300 characters/);
  });

  it("rejects a sign-off with a sender name, in English or French", () => {
    for (const ending of ["Best,\nAlex", "Thanks,\n[Your Name]", "Best, Alex", "Cordialement"]) {
      const message = `Hi Dana, saw your post on AI receptionists. Open to connecting?\n\n${ending}`;
      expect(checkLeadMessage(lead, "linkedin_connection_request", message).join(" ")).toMatch(
        /sign-off/,
      );
    }
  });

  it("allows a closing sentence that is not a sign-off", () => {
    const message =
      "Hi Dana, thanks for sharing that post on AI receptionists. Open to connecting?";
    expect(checkLeadMessage(lead, "linkedin_connection_request", message)).toEqual([]);
  });

  it("does not apply outreach rules to an internal sales brief", () => {
    expect(checkLeadMessage(lead, "sales_handoff", "Requested a demo. Call today.")).toEqual([]);
  });
});

describe("patient message policy", () => {
  const patient = makePatient({ conditions: ["Diabetes mellitus type 2", "Hypertension"] });

  it("passes a friendly SMS with an opt-out", () => {
    const message =
      "Hi Maria, it's time to book a follow-up visit. Reply YES to schedule. Reply STOP to opt out.";
    expect(checkPatientMessage(patient, "sms", message)).toEqual([]);
  });

  it("blocks any mention of the patient's conditions", () => {
    const message = "Hi Maria, let's check on your diabetes. Reply STOP to opt out.";
    expect(checkPatientMessage(patient, "sms", message).join(" ")).toMatch(/diabetes/);
  });

  it("requires opt-out text and a length limit for SMS", () => {
    const problems = checkPatientMessage(patient, "sms", `Hi Maria, ${"a".repeat(320)}`);
    expect(problems.join(" ")).toMatch(/320 characters/);
    expect(problems.join(" ")).toMatch(/opt-out/);
  });

  it("allows condition names in a brief for the care team", () => {
    expect(checkPatientMessage(patient, "care_team_review", "Review diabetes plan first.")).toEqual(
      [],
    );
  });
});
