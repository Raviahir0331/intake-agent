import { z } from "zod";
import type { LeadRecord } from "../records/unifiedRecord";
import { issueMessages } from "../shared/validation";
import {
  checkMessageTool,
  defineTool,
  submitDecisionTool,
  type AgentProfile,
} from "./agentProfile";
import { LEAD_CATEGORIES, LEAD_CHANNELS, leadDecisionSchema, type LeadDecision } from "./decision";
import { hasInboundRequest, isConnected, scoreLead } from "./leadScoring";
import { checkLeadMessage } from "./messagePolicy";
import { LEAD_PROMPT_VERSION, LEAD_SYSTEM_PROMPT } from "./prompts/leadPrompt";

const checkMessageArgs = z.object({ channel: z.enum(LEAD_CHANNELS), message: z.string() });

export const leadProfile: AgentProfile<LeadRecord, LeadDecision> = {
  promptVersion: LEAD_PROMPT_VERSION,
  systemPrompt: LEAD_SYSTEM_PROMPT,
  tools: [
    defineTool(
      "get_lead_score",
      "Rule-based score (0-100) for a lead, with the signals behind it.",
      {
        lead_id: { type: "string", description: "The record id from the request, e.g. lead:L001" },
      },
    ),
    checkMessageTool(LEAD_CHANNELS),
    submitDecisionTool(LEAD_CATEGORIES, LEAD_CHANNELS),
  ],

  decideWithRules(lead) {
    if (!hasInboundRequest(lead)) return null;

    // They asked us for something. A person should reply quickly; no AI copy needed.
    const { person, lead: details } = lead;
    return {
      category: "hot",
      channel: "sales_handoff",
      escalate: true,
      tone: "internal",
      language: "en",
      message:
        `${person.fullName} (${details.jobTitle}, ${details.company}) reached out: ` +
        `"${details.connectionNote}". Reply within the hour.`,
      rationale:
        "Inbound request from the lead. Rule: inbound requests always go straight to sales.",
      confidence: 1,
    };
  },

  describeRecord(lead) {
    const { person, location, lead: details } = lead;
    return [
      `Lead to qualify (record id: ${lead.id})`,
      `Name: ${person.fullName}`,
      `Role: ${details.jobTitle} at ${details.company}`,
      `Industry: ${details.industry}, company size ${details.companySize}`,
      `Location: ${[location.city, location.region, location.country].filter(Boolean).join(", ")}`,
      `Headline: ${details.headline}`,
      `Recent activity: ${details.recentActivity}`,
      `How we know them: ${details.connectionNote}`,
      `Already connected on LinkedIn: ${isConnected(lead) ? "yes" : "no"}`,
    ].join("\n");
  },

  runTool(name, args, lead) {
    if (name === "get_lead_score") {
      const requestedId = (args as { lead_id?: unknown } | undefined)?.lead_id;
      if (requestedId !== lead.id) return { error: `Unknown lead id. Use ${lead.id}.` };
      return scoreLead(lead);
    }

    if (name === "check_message") {
      const parsed = checkMessageArgs.safeParse(args);
      if (!parsed.success) return { error: issueMessages(parsed.error) };
      const problems = checkLeadMessage(lead, parsed.data.channel, parsed.data.message);
      return { ok: problems.length === 0, problems, characters: parsed.data.message.length };
    }

    return { error: `Unknown tool: ${name}` };
  },

  validateDecision(args, lead) {
    const parsed = leadDecisionSchema.safeParse(args);
    if (!parsed.success) return { ok: false, problems: issueMessages(parsed.error) };

    const decision = parsed.data;
    const problems: string[] = [];

    if (decision.category === "hot" && decision.channel !== "sales_handoff") {
      problems.push("hot leads must use channel sales_handoff");
    }
    if (decision.channel === "sales_handoff" && !decision.escalate) {
      problems.push("sales_handoff means a human takes over, so escalate must be true");
    }
    if (decision.channel === "linkedin_message" && !isConnected(lead)) {
      problems.push("we are not connected with this lead yet; use linkedin_connection_request");
    }
    problems.push(...checkLeadMessage(lead, decision.channel, decision.message));

    return problems.length ? { ok: false, problems } : { ok: true, decision };
  },

  fallbackDecision(lead, reason) {
    return {
      category: scoreLead(lead).suggestedTier,
      channel: "sales_handoff",
      escalate: true,
      tone: "internal",
      language: "en",
      message: `Agent could not finish this lead (${reason}). Please review and reach out manually.`,
      rationale: `Fallback: ${reason}`,
      confidence: 0,
    };
  },
};
