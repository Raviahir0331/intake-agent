// Compares the lead tiers from a run with the hand-labelled tiers in data/expected_lead_tiers.json.
//   npm run eval                     uses the latest run
//   npm run eval -- output/runs/<id> uses a specific run
import "../src/checkNodeVersion";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../src/paths";
import type { RunReport } from "../src/runReport";
import { findRunDir } from "./latestRun";

const runDir = await findRunDir(process.argv[2]);
const report = JSON.parse(await readFile(join(runDir, "run_report.json"), "utf8")) as RunReport;
type ExpectedTiers = Record<string, string>;
const expected = JSON.parse(await readFile(PATHS.expectedLeadTiers, "utf8")) as ExpectedTiers;

const rows = report.records
  .filter((outcome) => outcome.type === "lead")
  .map((outcome) => {
    const leadId = outcome.recordId.replace(/^lead:/, "");
    const expectedTier = expected[leadId];
    return {
      lead: leadId,
      expected: expectedTier ?? "-",
      agent: outcome.category,
      "decided by": outcome.decidedBy,
      match: expectedTier === outcome.category ? "yes" : "NO",
    };
  });

const labelled = rows.filter((row) => row.expected !== "-");
const matches = labelled.filter((row) => row.match === "yes").length;

if (labelled.length === 0) {
  console.error(`\nNo labelled leads in ${report.runId}, so there is nothing to compare.\n`);
  process.exit(1);
}

console.log(`\nLead tier agreement for ${report.runId} (${report.mode}, model: ${report.model})`);
console.table(rows);
console.log(
  `Agreement: ${matches}/${labelled.length} (${Math.round((matches / labelled.length) * 100)}%)`,
);
console.log("Open the trace for any NO row to see the agent's rationale.\n");
