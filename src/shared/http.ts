export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly responseBody?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type RequestOptions = {
  timeoutMs: number;
  headers?: Record<string, string>;
};

export async function getJson(
  url: string,
  { timeoutMs, headers }: RequestOptions,
): Promise<unknown> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const body = await readBody(response);

  if (!response.ok) {
    throw new HttpError(response.status, `GET ${url} returned ${response.status}`, body);
  }
  return body;
}

export async function postJson(
  url: string,
  payload: unknown,
  { timeoutMs, headers }: RequestOptions,
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await readBody(response);

  if (!response.ok) {
    throw new HttpError(response.status, `POST ${url} returned ${response.status}`, body);
  }
  return body;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
