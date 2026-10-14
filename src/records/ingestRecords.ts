import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config";
import { PATHS } from "../paths";
import { readLeadRows } from "../sources/linkedinCsv";
import {
  fetchPatientsWithConditions,
  loadPatientsFromFile,
  type PatientBundle,
} from "../sources/fhirPatients";
import { logger } from "../shared/logger";
import { describeError } from "../shared/retry";
import { normalizeLead } from "./normalizeLead";
import { normalizePatient } from "./normalizePatient";
import type { RejectedRecord, UnifiedRecord } from "./unifiedRecord";

export type IngestOptions = {
  offline: boolean;
  injectFailures: boolean;
  fhir: AppConfig["fhir"];
};

export async function ingestRecords(options: IngestOptions) {
  const records: UnifiedRecord[] = [];
  const rejected: RejectedRecord[] = [];
  const reject = (sourceRef: string, reason: string) =>
    rejected.push({ sourceRef, stage: "ingest", reason });

  // Source A: LinkedIn-style CSV
  const leadFiles = options.injectFailures ? [PATHS.leadsCsv, PATHS.badLeadsCsv] : [PATHS.leadsCsv];
  for (const file of leadFiles) {
    for (const row of await readLeadRows(file)) {
      const result = normalizeLead(row);
      if (result.ok) records.push(result.record);
      else reject(row.sourceRef, result.reason);
    }
  }

  // Source B: FHIR R4 patients. If the server is down we still process the leads.
  const fhirBaseUrl = options.offline ? "fixture" : options.fhir.baseUrl;
  const bundles: PatientBundle[] = [];
  try {
    if (options.offline) {
      bundles.push(...(await loadPatientsFromFile(PATHS.fhirFixture)));
    } else {
      const fetched = await fetchPatientsWithConditions({
        baseUrl: options.fhir.baseUrl,
        count: options.fhir.patientCount,
      });
      bundles.push(...fetched.bundles);
      fetched.failures.forEach((failure) => reject(failure.sourceRef, failure.reason));
    }
  } catch (error) {
    logger.error(
      { error: describeError(error) },
      "could not load patients, continuing with leads only",
    );
    reject(fhirBaseUrl, `FHIR source unavailable: ${describeError(error)}`);
  }

  if (options.injectFailures) {
    bundles.push({
      patient: JSON.parse(await readFile(PATHS.brokenPatient, "utf8")),
      conditions: [],
    });
  }

  for (const bundle of bundles) {
    const result = normalizePatient(bundle, fhirBaseUrl);
    if (result.ok) records.push(result.record);
    else reject(`${fhirBaseUrl}/Patient/${patientId(bundle)}`, result.reason);
  }

  const leads = records.filter((record) => record.type === "lead").length;
  logger.info(
    { leads, patients: records.length - leads, rejected: rejected.length },
    "ingested and normalized records",
  );

  return { records, rejected };
}

function patientId(bundle: PatientBundle): string {
  const id = (bundle.patient as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : "unknown";
}
