import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeE164Phone, normalizeUsPhone } from "@/lib/phone";
import { onboardingRateLimited } from "@/lib/onboarding-rate-limit";
import { submitAlphaOnboarding } from "@/lib/onboarding";
import { getPublicListing } from "@/lib/public-listings";
import { ACQUISITION_SOURCES, validTrackingToken } from "@/lib/tracking";
import { publicTokenSchema } from "@/lib/validation";

const schema = z.object({
  phone: z.string().min(8).max(32),
  source: z.enum(ACQUISITION_SOURCES),
  visitorId: z.string().max(100).optional(),
  attributionId: z.string().max(100).optional(),
  originatingListing: publicTokenSchema.optional(),
}).strict();

const DEFAULT_ALLOWED_ORIGINS = [
  "http://127.0.0.1:4200",
  "http://localhost:4200",
  "http://127.0.0.1:3001",
  "http://localhost:3001",
];

function allowedOrigins(): Set<string> {
  const configuredOrigins = (process.env.DIBS_WEB_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(origin => origin && origin !== "*");
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins]);
}

function withCors(request: Request, response: NextResponse): NextResponse {
  response.headers.set("Vary", "Origin");
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins().has(origin)) response.headers.set("Access-Control-Allow-Origin", origin);
  return response;
}

export function OPTIONS(request: Request) {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return withCors(request, response);
}

async function handlePost(request: Request) {
  try {
    if (await onboardingRateLimited(request)) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  } catch { return NextResponse.json({ error: "Could not accept onboarding right now." }, { status: 503 }); }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(contentLength) || contentLength > 2048) return NextResponse.json({ error: "Invalid onboarding request." }, { status: 413 });
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return NextResponse.json({ error: "Invalid onboarding request." }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return NextResponse.json({ error: "Invalid onboarding request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid onboarding request." }, { status: 400 });
  const candidate = parsed.data.phone.trim();
  const phone = candidate.startsWith("+1")
    ? normalizeUsPhone(candidate)
    : normalizeE164Phone(candidate) || normalizeUsPhone(candidate);
  const visitorId = parsed.data.visitorId === undefined ? null : validTrackingToken(parsed.data.visitorId);
  const attributionId = parsed.data.attributionId === undefined ? null : validTrackingToken(parsed.data.attributionId);
  if (!phone || (parsed.data.visitorId !== undefined && !visitorId) || (parsed.data.attributionId !== undefined && !attributionId)) {
    return NextResponse.json({ error: "Invalid onboarding request." }, { status: 400 });
  }
  try {
    const listing = parsed.data.originatingListing ? await getPublicListing(parsed.data.originatingListing) : null;
    if (parsed.data.originatingListing && !listing) return NextResponse.json({ error: "Invalid onboarding request." }, { status: 400 });
    const onboarding = await submitAlphaOnboarding({ phone, source: parsed.data.source, visitorId, attributionId, originatingListingId: listing?.id || null });
    const initiated = onboarding.state === "sent" || onboarding.state === "replied";
    return NextResponse.json({ accepted: true, initiated }, { status: initiated ? 200 : 202 });
  } catch {
    return NextResponse.json({ error: "Could not accept onboarding right now." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  return withCors(request, await handlePost(request));
}