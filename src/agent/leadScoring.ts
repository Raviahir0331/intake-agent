import type { LeadRecord } from "../records/unifiedRecord";

export type LeadScore = {
  score: number;
  suggestedTier: "warm" | "cold";
  reasons: string[];
};

/** "Requested a demo", "Requested pricing info", "Requested a call": someone is waiting on us. */
export function hasInboundRequest(lead: LeadRecord): boolean {
  const { recentActivity, connectionNote } = lead.lead;
  return /\brequested (a |an )?(demo|pricing|call|quote)\b/i.test(
    `${recentActivity} ${connectionNote}`,
  );
}

/** LinkedIn only allows a direct message once you're connected. */
export function isConnected(lead: LeadRecord): boolean {
  return /^connected\b/i.test(lead.lead.connectionNote);
}

// Topics close to what we sell (AI receptionists / voice agents for clinics).
const PRODUCT_TOPICS =
  /\b(ai|receptionists?|voice|calls?|booking|scheduling|no-shows?|follow-up|front-desk|chatbot|automation|ghl|crm|wait times?|retention|after-hours|multilingual)\b/i;

const WARM_THRESHOLD = 50;

type Rule = { match: RegExp; points: number; reason: string };
type RuleGroup = { field: keyof LeadRecord["lead"]; rules: Rule[] };

// Each group adds the points of its first matching rule, so order inside a group matters.
const SCORING: RuleGroup[] = [
  // Intent: what they did recently
  {
    field: "recentActivity",
    rules: [
      { match: /no recent activity|dormant/i, points: 0, reason: "no recent activity" },
      {
        match: /asking|looking for|recommendations|struggling/i,
        points: 25,
        reason: "actively looking for a solution",
      },
      { match: /commented|posted/i, points: 15, reason: "wrote about the topic publicly" },
      { match: /shared|liked|attended/i, points: 8, reason: "light engagement with content" },
    ],
  },
  {
    field: "recentActivity",
    rules: [{ match: /competitor/i, points: 10, reason: "engaged with a competitor" }],
  },
  {
    field: "recentActivity",
    rules: [{ match: PRODUCT_TOPICS, points: 15, reason: "activity matches what we sell" }],
  },

  // Authority
  {
    field: "jobTitle",
    rules: [
      {
        match: /owner|founder|ceo|president|\bvp\b|director|chief/i,
        points: 15,
        reason: "decision maker",
      },
      { match: /manager|lead|administrator|head/i, points: 8, reason: "influences the decision" },
    ],
  },

  // Fit: multi-location practices buy fastest; very large groups buy slowly
  {
    field: "companySize",
    rules: [
      { match: /^(11-50|51-200)$/, points: 10, reason: "company size in our sweet spot" },
      { match: /./, points: 5, reason: "company size outside our sweet spot" },
    ],
  },

  // Relationship
  {
    field: "connectionNote",
    rules: [
      { match: /warm intro|existing client|partner/i, points: 25, reason: "warm introduction" },
      { match: /mutual/i, points: 15, reason: "mutual connection" },
      {
        match: /webinar|ad campaign|connected|viewed our page/i,
        points: 10,
        reason: "has already engaged with us",
      },
      { match: /./, points: 0, reason: "cold, no relationship yet" },
    ],
  },
];

/**
 * Deterministic score from 0 to 100. It's cheap, explainable and the same on every run, so the
 * agent uses it as evidence instead of re-deriving it each time.
 */
export function scoreLead(lead: LeadRecord): LeadScore {
  let score = 0;
  const reasons: string[] = [];

  for (const group of SCORING) {
    const rule = group.rules.find((candidate) => candidate.match.test(lead.lead[group.field]));
    if (!rule) continue;
    score += rule.points;
    reasons.push(`+${rule.points} ${rule.reason}`);
  }

  score = Math.min(score, 100);
  return { score, suggestedTier: score >= WARM_THRESHOLD ? "warm" : "cold", reasons };
}
