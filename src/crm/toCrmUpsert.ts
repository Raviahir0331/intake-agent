import { scoreLead } from "../agent/leadScoring";
import type { AgentRun } from "../agent/runAgent";
import type { UnifiedRecord } from "../records/unifiedRecord";
import type { CrmUpsert } from "./crmPayload";

const MOCK_LOCATION_ID = "loc_mock_clinic_growth";

// Channels where a person acts next, or nothing is sent at all.
const NON_OUTREACH_CHANNELS = new Set(["sales_handoff", "care_team_review", "none"]);

export function toCrmUpsert(record: UnifiedRecord, run: AgentRun): CrmUpsert {
  const { decision } = run;
  const sendsOutreach = !NON_OUTREACH_CHANNELS.has(decision.channel);

  return {
    locationId: MOCK_LOCATION_ID,
    contact: {
      externalId: record.id,
      firstName: record.person.firstName,
      lastName: record.person.lastName,
      email: record.contact.email,
      phone: record.contact.phone,
      companyName: record.type === "lead" ? record.lead.company : undefined,
      city: record.location.city,
      state: record.location.region,
      country: record.location.country,
      source: record.type === "lead" ? "LinkedIn Sales Navigator" : "SMART Health IT FHIR",
      tags: buildTags(record, run),
      dnd: decision.category === "do_not_contact",
      customFields: [
        { key: "agent_category", field_value: decision.category },
        { key: "agent_channel", field_value: decision.channel },
        { key: "agent_confidence", field_value: decision.confidence },
        { key: "decided_by", field_value: run.decidedBy },
        { key: "prompt_version", field_value: run.promptVersion },
        ...sourceFields(record),
      ],
    },
    outreach: sendsOutreach
      ? {
          channel: decision.channel,
          language: decision.language,
          subject: decision.subject ?? undefined,
          message: decision.message,
        }
      : null,
    note: {
      body: sendsOutreach
        ? `Agent: ${decision.rationale}`
        : `Agent: ${decision.rationale}\n\nBrief: ${decision.message}`,
    },
    task: decision.escalate
      ? {
          title: taskTitle(record, run),
          assignedTo: record.type === "lead" ? "sales" : "care_team",
          dueInHours: decision.category === "hot" ? 1 : 24,
        }
      : null,
  };
}

function buildTags(record: UnifiedRecord, run: AgentRun): string[] {
  const tags: string[] = [record.type, run.decision.category];
  if (run.decision.escalate) tags.push("needs-human");
  if (run.decidedBy === "fallback") tags.push("agent-fallback");
  if (run.decision.language !== "en") tags.push(`lang-${run.decision.language}`);
  return tags;
}

function sourceFields(record: UnifiedRecord): CrmUpsert["contact"]["customFields"] {
  if (record.type === "patient") {
    return [{ key: "fhir_patient_id", field_value: record.id.replace(/^patient:/, "") }];
  }
  return [
    { key: "job_title", field_value: record.lead.jobTitle },
    { key: "industry", field_value: record.lead.industry },
    { key: "company_size", field_value: record.lead.companySize },
    { key: "lead_score", field_value: scoreLead(record).score },
  ];
}

function taskTitle(record: UnifiedRecord, run: AgentRun): string {
  const name = record.person.fullName;
  if (run.decidedBy === "fallback") return `Review ${name}: agent could not decide`;
  if (record.type === "lead") return `Call ${name} (${record.lead.company})`;
  return run.decision.category === "clinical_review"
    ? `Clinical review before outreach: ${name}`
    : `Follow up with ${name}`;
}
