// Compares the lead tiers from a run with the hand-labelled tiers in data/expected_lead_tiers.json.
//   npm run eval                     uses the latest run
//   npm run eval -- output/runs/<id> uses a specific run
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../src/paths";
import type { RunReport } from "../src/runReport";

const runDir = process.argv[2] ?? (await findLatestRun());
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

console.log(`\nLead tier agreement for ${report.runId} (${report.mode}, model: ${report.model})`);
console.table(rows);
console.log(
  `Agreement: ${matches}/${labelled.length} (${Math.round((matches / labelled.length) * 100)}%)`,
);
console.log("Open the trace for any NO row to see the agent's rationale.\n");

async function findLatestRun(): Promise<string> {
  const runsDir = join(PATHS.output, "runs");
  const runs = (await readdir(runsDir)).filter((name) => name.startsWith("run_")).sort();
  const latest = runs.at(-1);
  if (!latest) throw new Error(`No runs found in ${runsDir}. Run the pipeline first.`);
  return join(runsDir, latest);
}
