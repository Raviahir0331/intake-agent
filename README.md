# Intake Agent

An agent that takes leads from a LinkedIn Sales Navigator style CSV and patients from the SMART
Health IT FHIR R4 sandbox, decides what to do with each one, writes the outreach message, and
pushes the result to a mock CRM.

```
mock_leads.csv ──┐
                 ├─► normalize ─► unified records ─► rules or agent loop ─► CRM upsert
FHIR R4 sandbox ─┘        │                                 │                   │
                    rejected list                  trace per record    retry + idempotent
```

## Quick start

Requires Node 20.12 or newer.

```bash
npm install
cp .env.example .env          # paste your Gemini key into LLM_API_KEY
npm run pipeline:failures     # full run, including the deliberate failure cases
npm run eval                  # how often the agent agrees with the hand-labelled lead tiers
```

No API key yet? `npm run pipeline:offline` runs the whole thing with a scripted stand-in model and
a saved FHIR fixture, so you can see the plumbing work without any network access.

Get a free Gemini key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The
free tier is rate limited, so `LLM_REQUESTS_PER_MINUTE` (default 8) spaces calls out. A full run
makes roughly 90 LLM calls, which takes about 12 minutes at that rate. Raise it if your quota allows.

## Commands

| Command                     | What it does                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `npm run pipeline`          | Live run: Gemini, SMART FHIR sandbox, mock CRM started in-process                 |
| `npm run pipeline:failures` | Same, plus bad CSV rows, a malformed FHIR Patient and a CRM that times out twice  |
| `npm run pipeline:offline`  | Scripted model + FHIR fixture + failure cases. No key or network needed           |
| `npm run crm`               | Run the mock CRM on its own (`-- --slow 2` makes the first two requests time out) |
| `npm run eval`              | Compare lead tiers from the latest run with `data/expected_lead_tiers.json`       |
| `npm run save-sample`       | Copy the latest run into `sample_output/` for the submission                      |
| `npm run check`             | Typecheck, lint and tests                                                         |

## Project layout

```
src/
  cli.ts                  entry point, reads flags and .env
  pipeline.ts             ingest → decide → deliver → report
  processRecord.ts        one record: decide, map, deliver, write trace
  config.ts               env vars, validated with zod
  sources/                linkedinCsv.ts, fhirPatients.ts (paging, retries, offline fixture)
  records/                unifiedRecord.ts (the shared schema), normalizeLead.ts, normalizePatient.ts
  agent/
    runAgent.ts           the agent loop, shared by leads and patients
    leadProfile.ts        lead tools, rules, validation, fallback
    patientProfile.ts     patient tools, rules, validation, fallback
    leadScoring.ts        deterministic lead score the agent uses as evidence
    careSummary.ts        minimum-necessary clinical view for the agent
    messagePolicy.ts      hard rules every message must pass
    decision.ts           decision schemas
    prompts/              versioned system prompts
  llm/                    chatModel.ts (OpenAI-compatible client), rateLimiter.ts, offlineModel.ts
  crm/                    crmPayload.ts (schema), toCrmUpsert.ts, crmClient.ts, mockCrmServer.ts
  shared/                 logger, retry, http, validation helpers
scripts/                  evaluateAgent.ts, saveSample.ts
tests/                    unit tests + an offline end-to-end test
data/                     mock_leads.csv, expected tiers, FHIR fixture, failure cases
```

## How the agent works

There is one agent loop (`runAgent.ts`) and two profiles, one for leads and one for patients. A
profile is the system prompt, the tools, the hard rules and the fallback for that record type.

For each record:

1. **Rules first.** Some cases have one right answer and don't need an LLM. A lead who asked for a
   demo, pricing or a call goes straight to sales. A deceased patient is never contacted. A
   patient with no phone or email goes to the front desk.
2. **Agent loop.** The model gets a short description of the record and calls tools:
   - `get_lead_score` / `get_care_summary` to fetch evidence
   - `check_message` to test a draft against the sending rules
   - `submit_decision` to finish
3. **Validation and self-correction.** `submit_decision` is checked against the zod schema _and_
   the business rules (for example: no direct LinkedIn message unless we're connected, any risk
   flag means clinical review, no condition names in an SMS). Problems go back to the model as the
   tool result, and it tries again.
4. **Fallback.** If there's still no valid decision after 6 steps, or the LLM is unavailable after
   retries, the record goes to a human with a note explaining why. Nothing is dropped.

A typical agent record takes three LLM calls. Every step is saved in the record's trace file.

## The unified record

Both sources become a `UnifiedRecord` (`src/records/unifiedRecord.ts`): shared fields at the top
level (`person`, `contact`, `location`, `sourceRef`), and source-specific details under `lead` or
`patient`, with `type` as the discriminator. Adding a third source means writing one adapter and
one normalizer; the agent and the CRM mapping don't change.

FHIR details handled in `normalizePatient.ts`:

- prefers the `official` name and strips Synthea's numeric suffixes ("Aaron697" → "Aaron")
- accepts partial FHIR dates (`YYYY`, `YYYY-MM`) when calculating age
- keeps only active conditions (`active`, `recurrence`, `relapse`) and drops Synthea's social
  history entries such as "Full-time employment (finding)"
- marks deceased patients from `deceasedBoolean` or `deceasedDateTime`
- one malformed Condition is skipped without losing the patient

## Delivery

`toCrmUpsert.ts` maps each record and decision to an upsert payload based on GoHighLevel's contact
upsert (`firstName`, `companyName`, `tags`, `dnd`, `customFields` with `field_value`), plus the
outreach message, a note with the agent's rationale, and a task when a person needs to act. The
payload is validated before sending, and the mock CRM validates it again (422 on failure).

Upserts are keyed on `externalId` (for example `lead:L004`), so retries and re-runs update the
same contact instead of creating duplicates. Contacts land in `output/crm/contacts.json`.

## Failure handling

`--inject-failures` adds three deliberate failures:

| Failure                                                                             | What happens                                                                                                                                       |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/failure_cases/bad_leads.csv`: empty name, unknown company size, truncated row | Each row is rejected with the column and reason; the rest of the file is processed                                                                 |
| `data/failure_cases/broken_patient.json`: no name, `03/14/1980` birth date          | Rejected at ingest with both reasons                                                                                                               |
| Mock CRM answers the first two upserts too slowly                                   | The client times out after 2s, backs off and retries. The slow server still writes the contact later, and the upsert key stops it from duplicating |

Also handled without flags: FHIR and LLM 429/5xx/timeouts are retried with exponential backoff
(each attempt is logged), the free-tier rate limit is respected up front, and if the FHIR server is
down entirely the run continues with the leads.

## Observability

- **Logs:** structured JSON lines (pretty in a terminal): every record's decision, every retry,
  every rejected draft.
- **Traces:** `output/runs/<runId>/records/<recordId>.json` has the input, each tool call and
  result, rejected drafts with their problems, the final decision, the CRM request and response.
- **Run report:** `output/runs/<runId>/run_report.json` has totals (delivered, rejected, decided by
  rules / agent / fallback, retries), LLM calls and tokens, and per-record outcomes.
- **Eval:** `npm run eval` scores lead tiers against `data/expected_lead_tiers.json`. Re-run it
  after any prompt change; the prompt version is saved with every decision.

## Decisions and tradeoffs

- **One agent, two profiles, not a multi-agent setup.** Each record needs one chain of judgment.
  Splitting it into classifier, writer and reviewer agents would add latency, cost and failure
  points without better decisions at this size.
- **Rules where there's one right answer, the LLM where there's judgment.** Cheaper, faster and
  predictable for the cases that matter most (inbound leads, deceased patients).
- **Guardrails in code, not only in the prompt.** The prompt asks the model to follow the rules;
  `validateDecision` makes sure it did.
- **No LangChain.** The loop is about 140 lines and easy to read, debug and test. I'd look at
  LangGraph if this grew into longer multi-step workflows.
- **OpenAI-compatible client.** Gemini is the default; Groq or Ollama work by changing
  `LLM_BASE_URL` and `LLM_MODEL`.
- **Local mock CRM over webhook.site.** It validates the schema and supports upserts and failure
  simulation, which a webhook bin can't.

## Known limitations

- The lead score and condition keyword lists are simple regexes tuned to this data set.
- LinkedIn messages are queued in the CRM for a rep to send; nothing is sent automatically
  (automating LinkedIn is against its terms).
- Traces contain the full (synthetic) patient record. With real data they would need redaction
  and access control (see `WRITEUP.md`).
- Appointment resources aren't used; the SMART sandbox has few of them.

## Free services used

- Gemini API free tier via Google AI Studio (any OpenAI-compatible endpoint works)
- SMART Health IT public FHIR R4 sandbox (`https://r4.smarthealthit.org`)
- Local Express mock CRM (no account needed)
