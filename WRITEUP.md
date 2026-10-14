# Write-up

## Architecture decisions

The pipeline has three stages (ingest, decide, deliver) around one shared record type. Both
sources are normalized into a `UnifiedRecord` at the edge, and invalid input is rejected there
with a reason, so everything downstream can trust its input.

The decision stage is a single agent loop with two profiles (lead and patient). Each profile
defines its own tools, prompt, hard rules and fallback. Clear-cut cases (inbound requests,
deceased patients, no contact details) are decided by rules before the LLM is involved. For
everything else the model gathers evidence through tools, drafts a message, checks it, and
submits. The submission is validated in code against the schema and the business rules, and
rejected decisions go back to the model with the reasons. If it still can't produce a valid
decision, or the LLM is down, the record goes to a human. A record is never lost and never sent
unchecked.

Delivery is an idempotent upsert keyed on the record id, so retries and re-runs are safe.

## Handling 10,000 records or patients a day

10,000 a day is about 7 a minute on average, so raw throughput is not the problem. LLM quotas,
cost and reliability are. What I would change:

- **Queue between stages.** Ingest writes records to a queue (SQS, or BullMQ on Redis). Stateless
  workers run the agent and delivery, scale horizontally, and failed jobs go to a dead-letter
  queue that can be replayed.
- **One shared rate limiter** (a token bucket in Redis) instead of the in-process one, on a paid
  tier sized from measured usage. `run_report.json` already reports calls and tokens per record,
  which is the input for that sizing.
- **Spend LLM calls only where judgment is needed.** Today about 15% of records are decided by
  rules. Add caching by content hash so unchanged records aren't re-processed, and route by
  difficulty: a small model for routine patients, a larger one for ambiguous leads.
- **Incremental FHIR loads.** Use `_lastUpdated` for daily deltas, and Bulk Data `$export` for
  large backfills instead of paging through search results.
- **Monitoring.** Ship traces to a log store and alert on fallback rate, policy-rejection rate,
  delivery failures and p95 latency. Run the labelled eval set in CI on every prompt change.

## Compliance if real PHI were involved

- **BAAs everywhere PHI goes.** The LLM provider, CRM, hosting and log storage all need a HIPAA
  Business Associate Agreement. Free AI Studio keys are not covered, so real PHI would go through
  an enterprise offering under a BAA (for example Vertex AI) or a self-hosted model.
- **Minimum necessary.** The model already sees only first name, age band, gender, language and
  active conditions, never last name, birth date, address or phone. The next step would be mapping
  conditions to broad categories before they reach the model.
- **Logs and traces.** Today's traces store the full synthetic record. In production they would be
  redacted, encrypted at rest, access controlled, retained for a defined period, and every access
  audited.
- **Messages.** Patient SMS and email never name a condition (enforced in code) and always carry
  an opt-out. Consent and communication preferences would come from the EHR, and anything with a
  risk flag goes to a clinician first.
- **Access to the EHR.** Use SMART on FHIR with OAuth 2.0 and the narrowest scopes needed, over TLS.
- **Keep patient data out of marketing.** Lead outreach and patient outreach stay separate
  pipelines. Using patient data for marketing needs written authorization under HIPAA.
- **Lead outreach rules.** CAN-SPAM for email, CASL for the Canadian leads, and LinkedIn's terms,
  which is why LinkedIn messages are queued for a person to send rather than sent automatically.
