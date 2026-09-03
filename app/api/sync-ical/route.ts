import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { parseCalendar } from "@/lib/icalSync";
import { createPinnedLookup } from "@/lib/pinnedLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16_384;
const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

interface ValidatedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

interface CalendarResponse {
  status: number;
  location: string | null;
  body: string;
}

class SyncRequestError extends Error {
  constructor(message: string, readonly status = 400, readonly upstreamStatus?: number) {
    super(message);
    this.name = "SyncRequestError";
  }
}

function clientIdentifier(request: Request): string {
  return request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

function enforceRateLimit(request: Request): void {
  const now = Date.now();
  const key = clientIdentifier(request);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT) throw new SyncRequestError("Too many calendar requests. Wait a minute and try again.", 429);
  if (attempts.size > 5_000) {
    for (const [entryKey, entry] of attempts) if (entry.resetAt <= now) attempts.delete(entryKey);
  }
}

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::" || lower.startsWith("fc") || lower.startsWith("fd") || /^(fe8|fe9|fea|feb)/.test(lower)) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped ?? (isIP(address) === 4 ? address : null);
  if (!ipv4) return false;
  const [first, second] = ipv4.split(".").map(Number);
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19));
}

async function validateUrl(raw: unknown): Promise<ValidatedTarget> {
  if (typeof raw !== "string" || !raw.trim()) throw new SyncRequestError("Paste a non-empty Canvas calendar URL.");
  const normalized = raw.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new SyncRequestError("The Canvas calendar URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SyncRequestError("The calendar URL must use http or https.");
  if (url.username || url.password) throw new SyncRequestError("The calendar URL must not contain embedded credentials.");
  if (url.hostname.toLowerCase() === "localhost") throw new SyncRequestError("The calendar URL resolves to a private address.");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new SyncRequestError("Could not resolve the calendar hostname.");
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new SyncRequestError("The calendar URL resolves to a private address.");
  }
  const selected = addresses[0];
  return { url, address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

function requestCalendar(target: ValidatedTarget): Promise<CalendarResponse> {
  return new Promise((resolve, reject) => {
    const request = (target.url.protocol === "https:" ? httpsRequest : httpRequest)(target.url, {
      method: "GET",
      headers: { accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1", "accept-encoding": "identity" },
      lookup: createPinnedLookup(target.address, target.family),
    }, (response) => {
      const status = response.statusCode ?? 502;
      const locationHeader = response.headers.location;
      const location = Array.isArray(locationHeader) ? locationHeader[0] ?? null : locationHeader ?? null;
      const declaredLength = Number(response.headers["content-length"] ?? 0);
      if (declaredLength > MAX_CALENDAR_BYTES) {
        response.resume();
        reject(new SyncRequestError("Calendar feed is larger than the 5 MB safety limit.", 413));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_CALENDAR_BYTES) {
          request.destroy(new SyncRequestError("Calendar feed is larger than the 5 MB safety limit.", 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ status, location, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.setTimeout(15_000, () => request.destroy(new SyncRequestError("Calendar fetch timed out after 15 seconds.", 504)));
    request.on("error", (error) => reject(error));
    request.end();
  });
}

async function fetchCalendar(rawUrl: unknown): Promise<string> {
  let target = await validateUrl(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    let response: CalendarResponse;
    try {
      response = await requestCalendar(target);
    } catch (error) {
      if (error instanceof SyncRequestError) throw error;
      throw new SyncRequestError("Could not fetch the calendar feed.", 502);
    }
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new SyncRequestError("Calendar redirect did not include a destination.", 502, response.status);
      if (redirects === 5) throw new SyncRequestError("Calendar feed redirected too many times.", 502);
      target = await validateUrl(new URL(response.location, target.url).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new SyncRequestError(`Calendar server returned HTTP ${response.status}.`, 502, response.status);
    if (!response.body.includes("BEGIN:VCALENDAR")) throw new SyncRequestError("The URL did not return an iCalendar feed.", 422);
    return response.body;
  }
  throw new SyncRequestError("Calendar feed redirected too many times.", 502);
}

export async function POST(request: Request) {
  try {
    enforceRateLimit(request);
    const requestLength = Number(request.headers.get("content-length") ?? 0);
    if (requestLength > MAX_REQUEST_BYTES) throw new SyncRequestError("Request is too large.", 413);
    let body: Record<string, unknown>;
    try {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > MAX_REQUEST_BYTES) throw new SyncRequestError("Request is too large.", 413);
      body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyncRequestError) throw error;
      throw new SyncRequestError("Request body must be valid JSON.");
    }
    const parsed = await parseCalendar(await fetchCalendar(body.icalUrl));
    return NextResponse.json(
      { ok: true, parsed },
      { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  } catch (error) {
    const known = error instanceof SyncRequestError ? error : new SyncRequestError("Calendar preview failed.", 500);
    return NextResponse.json(
      { ok: false, error: known.message, ...(known.upstreamStatus ? { upstreamStatus: known.upstreamStatus } : {}) },
      { status: known.status, headers: { "cache-control": "no-store" } },
    );
  }
}
