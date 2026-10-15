// Picks the run that eval and save-sample work on: the folder given on the command line, or the
// newest run in output/runs that finished (has a run_report.json). Exits with a short message
// instead of a stack trace when there is nothing to use.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PATHS } from "../src/paths";

export async function findRunDir(arg: string | undefined): Promise<string> {
  if (arg) {
    const runDir = resolve(arg);
    if (!existsSync(join(runDir, "run_report.json"))) {
      exitWithMessage(
        `No run_report.json in ${runDir}.\nPass a run folder, for example output/runs/run_2026-...`,
      );
    }
    return runDir;
  }

  const runsDir = join(PATHS.output, "runs");
  const runs = existsSync(runsDir)
    ? (await readdir(runsDir)).filter((name) => name.startsWith("run_")).sort()
    : [];

  // Newest first. A run that was stopped before the end has traces but no report, so skip it.
  for (const name of runs.reverse()) {
    if (existsSync(join(runsDir, name, "run_report.json"))) return join(runsDir, name);
  }

  exitWithMessage(
    "No finished runs in output/runs yet. Run the pipeline first:\n" +
      "  npm run pipeline:failures   live run (needs LLM_API_KEY in .env)\n" +
      "  npm run pipeline:offline    no key or network needed",
  );
}

function exitWithMessage(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}
