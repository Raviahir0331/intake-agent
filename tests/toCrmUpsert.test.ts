import { describe, expect, it } from "vitest";
import { decideOutreach } from "../src/agent/runAgent";
import { crmUpsertSchema } from "../src/crm/crmPayload";
import { toCrmUpsert } from "../src/crm/toCrmUpsert";
import { makeLead, makePatient, scriptedModel } from "./helpers";

describe("toCrmUpsert", () => {
  it("builds a valid payload with a sales task for a hot lead", async () => {
    const lead = makeLead({ connectionNote: "Requested a demo via website form" });
    const run = await decideOutreach(lead, scriptedModel([]).model);

    const payload = toCrmUpsert(lead, run);

    expect(crmUpsertSchema.safeParse(payload).success).toBe(true);
    expect(payload.contact.externalId).toBe("lead:L100");
    expect(payload.contact.companyName).toBe("Reyes Family Clinic");
    expect(payload.outreach).toBeNull(); // a person replies, not the automation
    expect(payload.task).toMatchObject({ assignedTo: "sales", dueInHours: 1 });
    expect(payload.contact.tags).toEqual(["lead", "hot", "needs-human"]);
  });

  it("marks deceased patients do-not-disturb and sends nothing", async () => {
    const patient = makePatient({ isDeceased: true });
    const run = await decideOutreach(patient, scriptedModel([]).model);

    const payload = toCrmUpsert(patient, run);

    expect(crmUpsertSchema.safeParse(payload).success).toBe(true);
    expect(payload.contact.dnd).toBe(true);
    expect(payload.outreach).toBeNull();
    expect(payload.task).toBeNull();
  });
});
