import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecordOutcome } from "./processRecord";
import type { RejectedRecord } from "./records/unifiedRecord";

export type RunReport = ReturnType<typeof buildRunReport>;

export function buildRunReport(input: {
  runId: string;
  mode: "live" | "offline";
  model: string;
  startedAt: Date;
  outcomes: RecordOutcome[];
  rejected: RejectedRecord[];
}) {
  const { outcomes } = input;
  const count = (test: (outcome: RecordOutcome) => boolean) => outcomes.filter(test).length;
  const sum = (pick: (outcome: RecordOutcome) => number) =>
    outcomes.reduce((total, o) => total + pick(o), 0);

  const agentRuns = outcomes.filter((o) => o.decidedBy !== "rules");
  const deliveryFailures: RejectedRecord[] = outcomes.flatMap((o) =>
    o.delivery.ok
      ? []
      : [{ sourceRef: o.recordId, stage: "delivery" as const, reason: o.delivery.error }],
  );

  return {
    runId: input.runId,
    mode: input.mode,
    model: input.model,
    startedAt: input.startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    totals: {
      processed: outcomes.length,
      leads: count((o) => o.type === "lead"),
      patients: count((o) => o.type === "patient"),
      delivered: count((o) => o.delivery.ok),
      deliveryFailed: deliveryFailures.length,
      rejectedAtIngest: input.rejected.length,
      decidedByRules: count((o) => o.decidedBy === "rules"),
      decidedByAgent: count((o) => o.decidedBy === "agent"),
      fallbacks: count((o) => o.decidedBy === "fallback"),
      escalatedToHuman: count((o) => o.escalate),
      deliveryRetries: sum((o) => (o.delivery.ok ? o.delivery.attempts - 1 : 0)),
    },
    llm: {
      calls: sum((o) => o.llmCalls),
      inputTokens: sum((o) => o.usage.inputTokens),
      outputTokens: sum((o) => o.usage.outputTokens),
      avgCallsPerAgentRecord: agentRuns.length
        ? round(sum((o) => o.llmCalls) / agentRuns.length)
        : 0,
      avgAgentMsPerRecord: agentRuns.length
        ? Math.round(agentRuns.reduce((t, o) => t + o.agentMs, 0) / agentRuns.length)
        : 0,
    },
    rejected: [...input.rejected, ...deliveryFailures],
    records: outcomes,
  };
}

export async function saveRunReport(runDir: string, report: RunReport) {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run_report.json"), JSON.stringify(report, null, 2));
}

export function printRunSummary(report: RunReport, runDir: string) {
  const rows = report.records.map((o) => ({
    record: o.recordId,
    category: o.category,
    channel: o.channel,
    "decided by": o.decidedBy,
    "llm calls": o.llmCalls,
    crm: o.delivery.ok ? `${o.delivery.status} (attempts: ${o.delivery.attempts})` : "FAILED",
  }));

  console.log(`\nRun ${report.runId} (${report.mode}, model: ${report.model})`);
  console.table(rows);

  if (report.rejected.length) {
    console.log("Rejected:");
    console.table(report.rejected);
  }

  const t = report.totals;
  console.log(
    `${t.delivered}/${t.processed} delivered | ${t.decidedByRules} by rules, ${t.decidedByAgent} by agent, ` +
      `${t.fallbacks} fallbacks | ${t.escalatedToHuman} need a human | ${t.rejectedAtIngest} rejected at ingest | ` +
      `${report.llm.calls} LLM calls, ${report.llm.inputTokens + report.llm.outputTokens} tokens`,
  );
  console.log(`Traces and report: ${runDir}\n`);
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
