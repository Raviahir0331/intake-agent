import { join } from "node:path";
import pLimit from "p-limit";
import type { AppConfig } from "./config";
import { createCrmClient } from "./crm/crmClient";
import { startMockCrm } from "./crm/mockCrmServer";
import { createChatModel } from "./llm/chatModel";
import { createOfflineModel } from "./llm/offlineModel";
import { PATHS } from "./paths";
import { processRecord, type RecordOutcome } from "./processRecord";
import { ingestRecords } from "./records/ingestRecords";
import { buildRunReport, printRunSummary, saveRunReport } from "./runReport";
import { logger } from "./shared/logger";

export type PipelineOptions = {
  config: AppConfig;
  /** Scripted model + saved FHIR fixture. No API key or network needed. */
  offline: boolean;
  /** Adds bad CSV rows, a broken FHIR Patient and a CRM that times out twice. */
  injectFailures: boolean;
  outputDir?: string;
};

export async function runPipeline({
  config,
  offline,
  injectFailures,
  outputDir = PATHS.output,
}: PipelineOptions) {
  const startedAt = new Date();
  const runId = `run_${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const runDir = join(outputDir, "runs", runId);
  logger.info({ runId, offline, injectFailures }, "pipeline started");

  // Created first so a missing API key fails the run before any work is done.
  const model = offline ? createOfflineModel() : createChatModel(config.llm);

  // 1. Ingest both sources into one record shape
  const { records, rejected } = await ingestRecords({ offline, injectFailures, fhir: config.fhir });

  // 2. Decide and deliver, a few records at a time
  const crmServer = await connectCrm(config, outputDir, injectFailures);
  const crm = createCrmClient(crmServer.url);
  const limit = pLimit(config.recordConcurrency);

  let outcomes: RecordOutcome[];
  try {
    outcomes = await Promise.all(
      records.map((record) =>
        limit(() => processRecord(record, { model, crm, traceDir: join(runDir, "records") })),
      ),
    );
  } finally {
    await crmServer.stop();
  }

  // 3. Report
  const report = buildRunReport({
    runId,
    mode: offline ? "offline" : "live",
    model: model.name,
    startedAt,
    outcomes,
    rejected,
  });
  await saveRunReport(runDir, report);
  printRunSummary(report, runDir);

  return report;
}

/** Uses CRM_URL when set, otherwise starts the mock CRM in this process. */
async function connectCrm(config: AppConfig, outputDir: string, injectFailures: boolean) {
  if (config.crm.url) return { url: config.crm.url, stop: async () => {} };

  return startMockCrm({
    port: config.crm.port,
    storeFile: join(outputDir, "crm", "contacts.json"),
    // Failure demo: the first two upserts are answered too slowly, so the client times out and retries.
    slowRequests: injectFailures ? 2 : 0,
  });
}
