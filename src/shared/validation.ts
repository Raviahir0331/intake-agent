import type { z } from "zod";

export function issueMessages(error: z.ZodError): string[] {
  return error.issues.map((issue) =>
    issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
  );
}

/** Turns zod issues into one readable line, e.g. "full_name: is empty; company_size: ..." */
export function describeIssues(error: z.ZodError): string {
  return issueMessages(error).join("; ");
}
