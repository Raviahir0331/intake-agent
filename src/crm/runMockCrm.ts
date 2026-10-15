// Runs the mock CRM on its own, for when you want it in a separate terminal:
//   npm run crm                  then   CRM_URL=http://localhost:4010 npm run pipeline
//   npm run crm -- --slow 2      to make the first two requests time out
import "../checkNodeVersion";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../config";
import { PATHS } from "../paths";
import { startMockCrm } from "./mockCrmServer";

const { values } = parseArgs({ options: { slow: { type: "string", default: "0" } } });
const config = loadConfig();

const crm = await startMockCrm({
  port: config.crm.port,
  storeFile: join(PATHS.output, "crm", "contacts.json"),
  slowRequests: Number(values.slow),
});

console.log(`Mock CRM running at ${crm.url}  (Ctrl+C to stop)`);
