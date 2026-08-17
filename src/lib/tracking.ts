import { randomUUID } from "node:crypto";
import { publicTokenSchema } from "./validation";

export const ACQUISITION_SOURCES = ["direct", "website", "public_share", "whatsapp", "facebook", "marketplace", "referral", "unknown"] as const;
export type AcquisitionSource = typeof ACQUISITION_SOURCES[number];

const trackingTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validTrackingToken(value: unknown): string | null {
  return typeof value === "string" && value.length <= 100 && trackingTokenPattern.test(value) ? value.toLowerCase() : null;
}

export function validOriginListingToken(value: unknown): string | null {
  const parsed = publicTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function validAcquisitionSource(value: unknown): AcquisitionSource | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ACQUISITION_SOURCES.find(source => source === normalized) || null;
}

export function newTrackingToken(): string {
  return randomUUID();
}

export function cookieValue(request: Request, name: string): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export type TrackingContext = {
  visitorId: string | null;
  attributionToken: string | null;
  originListingToken: string | null;
  acquisitionSource: AcquisitionSource | null;
};

export function trackingContext(request: Request): TrackingContext {
  return {
    visitorId: validTrackingToken(cookieValue(request, "dibs_visitor")),
    attributionToken: validTrackingToken(cookieValue(request, "dibs_attribution")),
    originListingToken: validOriginListingToken(cookieValue(request, "dibs_origin_listing")),
    acquisitionSource: validAcquisitionSource(cookieValue(request, "dibs_acquisition_source")),
  };
}

export function acquisitionForEvent(input: {
  existingSource: AcquisitionSource | null;
  existingOrigin: string | null;
  eventName: string;
  requestedSource: AcquisitionSource | null;
  listingToken: string;
  explicitBoundary?: boolean;
}) {
  const establish = input.eventName === "listing_page_viewed" && (!input.existingSource || input.explicitBoundary === true);
  return {
    source: establish ? (input.requestedSource || "public_share") : input.existingSource,
    origin: establish ? input.listingToken : input.existingOrigin,
    changed: establish,
  };
}