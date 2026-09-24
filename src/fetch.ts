const USER_AGENT =
  "Mozilla/5.0 (compatible; golive-mcp/1.0; +https://github.com/myanptl/golive-mcp)";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  headers: Headers;
  body: Buffer;
  redirects: { from: string; to: string; status: number }[];
  truncated: boolean;
}

export class FetchError extends Error {}

/**
 * Only http(s) is allowed. Localhost is allowed on purpose: checking a dev
 * server before deploying is a main use case, and this runs on the user's
 * own machine.
 */
export function parseTarget(input: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new FetchError(`Not a valid URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchError(`Only http and https URLs can be checked, got ${url.protocol}`);
  }
  return url;
}

async function readCapped(res: Response, maxBytes: number) {
  if (!res.body) return { body: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks), truncated };
}

export async function fetchUrl(
  input: string | URL,
  opts: { maxBytes?: number; followRedirects?: boolean } = {}
): Promise<FetchResult> {
  const start = parseTarget(typeof input === "string" ? input : input.href);
  const follow = opts.followRedirects ?? true;
  const redirects: FetchResult["redirects"] = [];
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError"
        ? `timed out after ${TIMEOUT_MS / 1000}s`
        : (err as Error).message;
      throw new FetchError(`Could not reach ${current.href}: ${reason}`);
    }

    const location = res.headers.get("location");
    if (follow && res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      redirects.push({ from: current.href, to: next.href, status: res.status });
      await res.body?.cancel();
      current = parseTarget(next.href);
      continue;
    }

    const { body, truncated } = await readCapped(res, opts.maxBytes ?? MAX_BYTES);
    return {
      url: start.href,
      finalUrl: current.href,
      status: res.status,
      headers: res.headers,
      body,
      redirects,
      truncated,
    };
  }
  throw new FetchError(`More than ${MAX_REDIRECTS} redirects starting at ${start.href}`);
}
