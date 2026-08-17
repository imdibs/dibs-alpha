import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { PUBLIC_EVENT_NAMES, recordProductEvent } from "@/lib/analytics";
import { getPublicListing } from "@/lib/public-listings";
import { acquisitionForEvent, newTrackingToken, trackingContext, validAcquisitionSource } from "@/lib/tracking";
import { publicTokenSchema } from "@/lib/validation";
import { publicEventRateLimited } from "@/lib/public-event-rate-limit";
import { z } from "zod";

const schema = z.object({
  eventName: z.enum(PUBLIC_EVENT_NAMES),
  listingToken: publicTokenSchema,
  source: z.enum(["direct", "public_share", "whatsapp", "facebook", "marketplace", "referral", "unknown"]).optional(),
  acquisitionBoundary: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  if (publicEventRateLimited(request)) return NextResponse.json({ error: "Too many events." }, { status: 429 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 4096) return NextResponse.json({ error: "Invalid event." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  const listing = await getPublicListing(parsed.data.listingToken);
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  const user = await currentUser();
  const tracking = trackingContext(request);
  const visitorId = tracking.visitorId || newTrackingToken();
  const attributionToken = tracking.attributionToken || newTrackingToken();
  const acquisition = acquisitionForEvent({ existingSource: tracking.acquisitionSource, existingOrigin: tracking.originListingToken, eventName: parsed.data.eventName, requestedSource: validAcquisitionSource(parsed.data.source), listingToken: listing.public_token!, explicitBoundary: parsed.data.acquisitionBoundary });
  try {
    await recordProductEvent({ eventName: parsed.data.eventName, userId: user?.id, listingId: listing.id, visitorId, attributionToken, source: parsed.data.source || null, metadata: acquisition.source ? { acquisitionSource: acquisition.source } : {} });
  } catch (error) {
    console.warn("Could not record public event", error);
    return NextResponse.json({ error: "Could not record event." }, { status: 503 });
  }
  const response = NextResponse.json({ ok: true });
  const options = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" };
  response.cookies.set("dibs_visitor", visitorId, options);
  response.cookies.set("dibs_attribution", attributionToken, options);
  if (acquisition.origin) response.cookies.set("dibs_origin_listing", acquisition.origin, options);
  if (acquisition.source) response.cookies.set("dibs_acquisition_source", acquisition.source, options);
  return response;
}