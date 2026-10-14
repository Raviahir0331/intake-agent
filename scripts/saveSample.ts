// Copies a run into sample_output/ so it can be committed with the submission.
//   npm run save-sample                     copies the latest run
//   npm run save-sample -- output/runs/<id> copies a specific run
import { cp, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { PATHS } from "../src/paths";

const runsDir = join(PATHS.output, "runs");
const runDir = process.argv[2] ?? join(runsDir, (await readdir(runsDir)).sort().at(-1) ?? "");
const target = join(PATHS.output, "..", "sample_output");

await rm(target, { recursive: true, force: true });
await cp(runDir, target, { recursive: true });
console.log(`Copied ${basename(runDir)} to sample_output/`);
