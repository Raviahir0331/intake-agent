import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fromRoot = (path: string) => join(projectRoot, path);

export const PATHS = {
  leadsCsv: fromRoot("data/mock_leads.csv"),
  fhirFixture: fromRoot("data/fixtures/fhir_patients.json"),
  expectedLeadTiers: fromRoot("data/expected_lead_tiers.json"),
  // Deliberately broken inputs for --inject-failures
  badLeadsCsv: fromRoot("data/failure_cases/bad_leads.csv"),
  brokenPatient: fromRoot("data/failure_cases/broken_patient.json"),
  output: fromRoot("output"),
};
