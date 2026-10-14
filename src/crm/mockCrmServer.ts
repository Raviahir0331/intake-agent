import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import express from "express";
import { logger } from "../shared/logger";
import { sleep } from "../shared/retry";
import { issueMessages } from "../shared/validation";
import { crmUpsertSchema, type CrmUpsert } from "./crmPayload";

export type MockCrmOptions = {
  port: number;
  storeFile: string;
  /** Simulate a struggling CRM: this many requests are answered too slowly and time out. */
  slowRequests?: number;
  slowResponseMs?: number;
};

type StoredContact = CrmUpsert & { id: string; createdAt: string; updatedAt: string };

/**
 * A small stand-in for the real CRM. It validates every payload against the shared schema,
 * upserts by externalId and keeps contacts in a JSON file so you can inspect what arrived.
 */
export async function startMockCrm(options: MockCrmOptions) {
  const contacts = loadStore(options.storeFile);
  let slowRequestsLeft = options.slowRequests ?? 0;

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, contacts: contacts.size });
  });

  app.get("/contacts", (_req, res) => {
    res.json([...contacts.values()]);
  });

  app.post("/contacts/upsert", async (req, res) => {
    if (slowRequestsLeft > 0) {
      slowRequestsLeft--;
      logger.warn(
        { externalId: req.body?.contact?.externalId },
        "mock CRM: simulating a slow response",
      );
      // The client gives up before this finishes, but we still write the contact afterwards,
      // just like a real overloaded server. Upsert-by-externalId keeps that from duplicating.
      await sleep(options.slowResponseMs ?? 3_000);
    }

    const parsed = crmUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "invalid payload", issues: issueMessages(parsed.error) });
      return;
    }

    const payload = parsed.data;
    const now = new Date().toISOString();
    const existing = contacts.get(payload.contact.externalId);
    const stored: StoredContact = {
      ...payload,
      id: existing?.id ?? `crm_${String(contacts.size + 1).padStart(4, "0")}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    contacts.set(payload.contact.externalId, stored);
    saveStore(options.storeFile, contacts);

    res.json({
      id: stored.id,
      externalId: payload.contact.externalId,
      status: existing ? "updated" : "created",
    });
  });

  const server = app.listen(options.port);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;
  logger.info({ port, storeFile: options.storeFile }, "mock CRM listening");

  return {
    url: `http://localhost:${port}`,
    contactCount: () => contacts.size,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export type MockCrm = Awaited<ReturnType<typeof startMockCrm>>;

function loadStore(file: string): Map<string, StoredContact> {
  if (!existsSync(file)) return new Map();
  const list = JSON.parse(readFileSync(file, "utf8")) as StoredContact[];
  return new Map(list.map((contact) => [contact.contact.externalId, contact]));
}

function saveStore(file: string, contacts: Map<string, StoredContact>) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...contacts.values()], null, 2));
}
