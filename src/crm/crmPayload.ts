import { z } from "zod";
import { LANGUAGES } from "../agent/decision";

/**
 * Upsert payload for the downstream CRM. The contact block follows the shape of GoHighLevel's
 * contact upsert (firstName, companyName, tags, dnd, customFields with `field_value`), trimmed
 * to what this pipeline produces. The mock CRM validates against this same schema.
 */
export const crmUpsertSchema = z.object({
  locationId: z.string().min(1),
  contact: z.object({
    externalId: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string(),
    email: z.email().optional(),
    phone: z.string().optional(),
    companyName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    source: z.enum(["LinkedIn Sales Navigator", "SMART Health IT FHIR"]),
    tags: z.array(z.string()),
    // "Do not disturb": blocks every automated channel in the CRM.
    dnd: z.boolean(),
    customFields: z.array(
      z.object({
        key: z.string(),
        field_value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ),
  }),
  outreach: z
    .object({
      channel: z.string(),
      language: z.enum(LANGUAGES),
      subject: z.string().optional(),
      message: z.string().min(1),
    })
    .nullable(),
  note: z.object({ body: z.string().min(1) }),
  task: z
    .object({
      title: z.string().min(1),
      assignedTo: z.enum(["sales", "care_team"]),
      dueInHours: z.number().int().positive(),
    })
    .nullable(),
});

export type CrmUpsert = z.infer<typeof crmUpsertSchema>;

export const crmUpsertResponseSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  status: z.enum(["created", "updated"]),
});

export type CrmUpsertResponse = z.infer<typeof crmUpsertResponseSchema>;
