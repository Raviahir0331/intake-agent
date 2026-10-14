import { existsSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.url().default("https://generativelanguage.googleapis.com/v1beta/openai/"),
  LLM_MODEL: z.string().default("gemini-3.8-flash"),
  LLM_REASONING_EFFORT: z.enum(["low", "medium", "high"]).optional(),
  LLM_REQUESTS_PER_MINUTE: z.coerce.number().positive().default(8),

  FHIR_BASE_URL: z.url().default("https://r4.smarthealthit.org"),
  PATIENT_COUNT: z.coerce.number().int().min(1).max(200).default(20),

  CRM_URL: z.url().optional(),
  CRM_PORT: z.coerce.number().int().default(4010),

  RECORD_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = readEnvFile()) {
  // `KEY=` in .env means "not set", not "empty string".
  const setValues = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = envSchema.safeParse(setValues);

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration in .env:\n${problems.join("\n")}`);
  }

  const values = parsed.data;
  return {
    llm: {
      apiKey: values.LLM_API_KEY,
      baseUrl: values.LLM_BASE_URL,
      model: values.LLM_MODEL,
      reasoningEffort: values.LLM_REASONING_EFFORT,
      requestsPerMinute: values.LLM_REQUESTS_PER_MINUTE,
    },
    fhir: {
      baseUrl: values.FHIR_BASE_URL.replace(/\/$/, ""),
      patientCount: values.PATIENT_COUNT,
    },
    crm: {
      url: values.CRM_URL,
      port: values.CRM_PORT,
    },
    recordConcurrency: values.RECORD_CONCURRENCY,
    logLevel: values.LOG_LEVEL,
  };
}

function readEnvFile(): NodeJS.ProcessEnv {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return process.env;
}
