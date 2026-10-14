import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { runPipeline } from "../src/pipeline";

describe("pipeline (offline, with injected failures)", () => {
  it("delivers every valid record, rejects the broken ones and survives CRM timeouts", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "intake-agent-"));
    const config = loadConfig({ CRM_PORT: "0", LOG_LEVEL: "silent" });

    const report = await runPipeline({ config, offline: true, injectFailures: true, outputDir });

    expect(report.totals.leads).toBe(18);
    expect(report.totals.patients).toBeGreaterThanOrEqual(15);
    expect(report.totals.delivered).toBe(report.totals.processed);
    expect(report.totals.deliveryRetries).toBeGreaterThanOrEqual(2);

    // 3 bad CSV rows + 1 malformed FHIR Patient
    const rejectedRefs = report.rejected.map((r) => r.sourceRef);
    expect(rejectedRefs).toHaveLength(4);
    expect(rejectedRefs).toContain("bad_leads.csv:line 2");
    expect(rejectedRefs).toContain("fixture/Patient/broken-0001");

    // Hot leads and the deceased patient are decided by rules, without the LLM.
    expect(report.totals.decidedByRules).toBeGreaterThanOrEqual(4);

    // One trace per processed record.
    const traces = await readdir(join(outputDir, "runs", report.runId, "records"));
    expect(traces).toHaveLength(report.totals.processed);

    // Timed-out requests were still written by the slow server, but upsert kept one copy each.
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    const stored = JSON.parse(
      await readFile(join(outputDir, "crm", "contacts.json"), "utf8"),
    ) as unknown[];
    expect(stored).toHaveLength(report.totals.processed);
  }, 30_000);
});
