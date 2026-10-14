import { readFile } from "node:fs/promises";
import pLimit from "p-limit";
import { getJson } from "../shared/http";
import { logger } from "../shared/logger";
import { describeError, withRetry } from "../shared/retry";

/** A Patient resource with its Condition resources, still raw FHIR. normalizePatient validates it. */
export type PatientBundle = {
  patient: unknown;
  conditions: unknown[];
};

type FhirResource = {
  resourceType?: string;
  id?: string;
  subject?: { reference?: string };
};

type FhirBundle = {
  entry?: Array<{ resource?: FhirResource }>;
  link?: Array<{ relation?: string; url?: string }>;
};

type FetchFailure = { sourceRef: string; reason: string };

const FHIR_HEADERS = { accept: "application/fhir+json" };
const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchPatientsWithConditions(options: {
  baseUrl: string;
  count: number;
}): Promise<{ bundles: PatientBundle[]; failures: FetchFailure[] }> {
  const patients = await fetchPatients(options.baseUrl, options.count);
  logger.info({ patients: patients.length }, "fetched patients from FHIR server");

  const limit = pLimit(5);
  const bundles: PatientBundle[] = [];
  const failures: FetchFailure[] = [];

  const conditionLists = await Promise.all(
    patients.map((patient) =>
      limit(() =>
        fetchConditions(options.baseUrl, patient.id ?? "").catch((error: unknown) => error),
      ),
    ),
  );

  patients.forEach((patient, index) => {
    const conditions = conditionLists[index];
    if (Array.isArray(conditions)) {
      bundles.push({ patient, conditions });
    } else {
      failures.push({
        sourceRef: `${options.baseUrl}/Patient/${patient.id}`,
        reason: `could not load conditions: ${describeError(conditions)}`,
      });
    }
  });

  return { bundles, failures };
}

async function fetchPatients(baseUrl: string, count: number): Promise<FhirResource[]> {
  const patients: FhirResource[] = [];
  let nextUrl: string | undefined = `${baseUrl}/Patient?_count=${Math.min(count, 50)}`;

  // Follow the Bundle's "next" links until we have enough patients or the server runs out.
  while (nextUrl && patients.length < count) {
    const page = await getBundle("fhir:patients", nextUrl);
    for (const entry of page.entry ?? []) {
      if (entry.resource?.resourceType === "Patient") patients.push(entry.resource);
    }
    nextUrl = page.link?.find((link) => link.relation === "next")?.url;
  }

  return patients.slice(0, count);
}

async function fetchConditions(baseUrl: string, patientId: string): Promise<FhirResource[]> {
  const url = `${baseUrl}/Condition?patient=${encodeURIComponent(patientId)}&_count=100`;
  const page = await getBundle(`fhir:conditions:${patientId}`, url);

  return (page.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is FhirResource => resource?.resourceType === "Condition");
}

async function getBundle(label: string, url: string): Promise<FhirBundle> {
  const body = await withRetry(label, () =>
    getJson(url, { timeoutMs: REQUEST_TIMEOUT_MS, headers: FHIR_HEADERS }),
  );
  return body as FhirBundle;
}

/**
 * Offline mode: same output shape as the live fetch, read from a saved FHIR Bundle that holds
 * Patients and Conditions together.
 */
export async function loadPatientsFromFile(filePath: string): Promise<PatientBundle[]> {
  const bundle = JSON.parse(await readFile(filePath, "utf8")) as FhirBundle;
  const resources = (bundle.entry ?? []).flatMap((entry) =>
    entry.resource ? [entry.resource] : [],
  );

  const conditionsByPatient = new Map<string, FhirResource[]>();
  for (const resource of resources) {
    if (resource.resourceType !== "Condition") continue;
    const patientRef = resource.subject?.reference ?? "";
    conditionsByPatient.set(patientRef, [...(conditionsByPatient.get(patientRef) ?? []), resource]);
  }

  return resources
    .filter((resource) => resource.resourceType === "Patient")
    .map((patient) => ({
      patient,
      conditions: conditionsByPatient.get(`Patient/${patient.id}`) ?? [],
    }));
}
