import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDecision, DecidedBy } from "./agent/decision";
import { decideOutreach, type AgentRun } from "./agent/runAgent";
import type { CrmClient } from "./crm/crmClient";
import { toCrmUpsert } from "./crm/toCrmUpsert";
import type { ChatModel, TokenUsage } from "./llm/chatModel";
import type { UnifiedRecord } from "./records/unifiedRecord";
import { logger } from "./shared/logger";
import { describeError } from "./shared/retry";

export type RecordOutcome = {
  recordId: string;
  type: UnifiedRecord["type"];
  category: AgentDecision["category"];
  channel: AgentDecision["channel"];
  escalate: boolean;
  decidedBy: DecidedBy;
  llmCalls: number;
  usage: TokenUsage;
  agentMs: number;
  delivery:
    { ok: true; crmId: string; status: string; attempts: number } | { ok: false; error: string };
};

type Dependencies = {
  model: ChatModel;
  crm: CrmClient;
  traceDir: string;
};

/** decide → map to the CRM schema → deliver → write a trace of all of it. */
export async function processRecord(
  record: UnifiedRecord,
  deps: Dependencies,
): Promise<RecordOutcome> {
  const run = await decideOutreach(record, deps.model);
  const payload = toCrmUpsert(record, run);

  let delivery: RecordOutcome["delivery"];
  try {
    const response = await deps.crm.upsertContact(payload);
    delivery = {
      ok: true,
      crmId: response.id,
      status: response.status,
      attempts: response.attempts,
    };
  } catch (error) {
    delivery = { ok: false, error: describeError(error) };
    logger.error({ recordId: record.id, error: delivery.error }, "CRM delivery failed");
  }

  logger.info(
    {
      recordId: record.id,
      category: run.decision.category,
      channel: run.decision.channel,
      decidedBy: run.decidedBy,
      llmCalls: run.llmCalls,
      delivered: delivery.ok,
    },
    "record processed",
  );

  await writeTrace(deps.traceDir, record, run, payload, delivery);

  return {
    recordId: record.id,
    type: record.type,
    category: run.decision.category,
    channel: run.decision.channel,
    escalate: run.decision.escalate,
    decidedBy: run.decidedBy,
    llmCalls: run.llmCalls,
    usage: run.usage,
    agentMs: run.durationMs,
    delivery,
  };
}

/**
 * One JSON file per record with the input, every agent step, the decision and the CRM result.
 * This is what you open to answer "why did the agent do that?".
 */
async function writeTrace(
  dir: string,
  record: UnifiedRecord,
  run: AgentRun,
  crmRequest: unknown,
  delivery: RecordOutcome["delivery"],
) {
  await mkdir(dir, { recursive: true });
  const trace = {
    recordId: record.id,
    input: record,
    agent: {
      decidedBy: run.decidedBy,
      promptVersion: run.promptVersion,
      llmCalls: run.llmCalls,
      usage: run.usage,
      durationMs: run.durationMs,
      steps: run.steps,
    },
    decision: run.decision,
    crm: { request: crmRequest, delivery },
  };
  const fileName = `${record.id.replace(/[^a-zA-Z0-9-]/g, "_")}.json`;
  await writeFile(join(dir, fileName), JSON.stringify(trace, null, 2));
}
