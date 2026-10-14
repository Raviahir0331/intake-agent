import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse } from "csv-parse/sync";

export type LeadRow = {
  values: Record<string, string | undefined>;
  sourceRef: string;
};

/**
 * Reads a Sales Navigator style export. Rows with missing or extra columns are still returned
 * (relax_column_count) so the normalizer can reject them one by one instead of failing the file.
 */
export async function readLeadRows(filePath: string): Promise<LeadRow[]> {
  const text = await readFile(filePath, "utf8");
  const parsed: Array<{ record: Record<string, string>; info: { lines: number } }> = parse(text, {
    columns: true,
    info: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  const fileName = basename(filePath);
  return parsed.map(({ record, info }) => ({
    values: record,
    sourceRef: `${fileName}:line ${info.lines}`,
  }));
}
