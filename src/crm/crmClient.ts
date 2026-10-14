import { postJson } from "../shared/http";
import { withRetry } from "../shared/retry";
import {
  crmUpsertResponseSchema,
  crmUpsertSchema,
  type CrmUpsert,
  type CrmUpsertResponse,
} from "./crmPayload";

const REQUEST_TIMEOUT_MS = 2_000;

export type CrmDelivery = CrmUpsertResponse & { attempts: number };

export function createCrmClient(baseUrl: string) {
  return {
    async upsertContact(payload: CrmUpsert): Promise<CrmDelivery> {
      // Catch mapping bugs here, before they turn into a 422 we'd then retry for nothing.
      const validPayload = crmUpsertSchema.parse(payload);
      let attempts = 0;

      const body = await withRetry(
        `crm:${payload.contact.externalId}`,
        (attempt) => {
          attempts = attempt;
          return postJson(`${baseUrl}/contacts/upsert`, validPayload, {
            timeoutMs: REQUEST_TIMEOUT_MS,
            // Upserting by externalId already makes retries safe; the header says so explicitly.
            headers: { "idempotency-key": payload.contact.externalId },
          });
        },
        { attempts: 4, baseDelayMs: 300 },
      );

      return { ...crmUpsertResponseSchema.parse(body), attempts };
    },
  };
}

export type CrmClient = ReturnType<typeof createCrmClient>;
