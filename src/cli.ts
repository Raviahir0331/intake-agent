import "./checkNodeVersion";
import { parseArgs } from "node:util";
import { loadConfig } from "./config";
import { runPipeline } from "./pipeline";
import { logger } from "./shared/logger";

const { values } = parseArgs({
  options: {
    offline: { type: "boolean", default: false },
    "inject-failures": { type: "boolean", default: false },
  },
});

try {
  const config = loadConfig();
  logger.level = config.logLevel;
  await runPipeline({ config, offline: values.offline, injectFailures: values["inject-failures"] });
} catch (error) {
  console.error(`\nPipeline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
