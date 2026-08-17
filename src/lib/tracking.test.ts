import { describe, expect, it } from "vitest";
import { acquisitionForEvent, trackingContext, validAcquisitionSource, validOriginListingToken, validTrackingToken } from "./tracking";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("tracking validation", () => {
  it("accepts bounded authoritative values", () => {
    expect(validTrackingToken(uuid)).toBe(uuid);
    expect(validOriginListingToken("7xK92pAb_Cde")).toBe("7xK92pAb_Cde");
    expect(validAcquisitionSource(" WhatsApp ")).toBe("whatsapp");
  });

  it.each(["", "x".repeat(101), "not a token", "../../private"])("rejects malformed tracking values: %s", value => {
    expect(validTrackingToken(value)).toBeNull();
  });

  it("rejects empty, oversized, invalid-character, and unexpected acquisition values", () => {
    expect(validOriginListingToken("")).toBeNull();
    expect(validOriginListingToken("x".repeat(101))).toBeNull();
    expect(validOriginListingToken("token!invalid")).toBeNull();
    expect(validAcquisitionSource("public_listing_cta")).toBeNull();
    expect(validAcquisitionSource("")).toBeNull();
  });

  it("never returns malformed cookie contents", () => {
    const request = new Request("https://dibs.chat", { headers: { cookie: "dibs_visitor=bad; dibs_attribution=%GG; dibs_origin_listing=../../x; dibs_acquisition_source=evil" } });
    expect(trackingContext(request)).toEqual({ visitorId: null, attributionToken: null, originListingToken: null, acquisitionSource: null });
  });
});

describe("acquisition semantics", () => {
  const existing = { existingSource: "whatsapp" as const, existingOrigin: "7xK92pAb_Cde", listingToken: "newToken_123" };

  it.each(["listing_page_viewed", "listing_cta_clicked", "listing_share_link_generated"])("preserves first acquisition on later %s", eventName => {
    expect(acquisitionForEvent({ ...existing, eventName, requestedSource: "public_share" })).toEqual({ source: "whatsapp", origin: "7xK92pAb_Cde", changed: false });
  });

  it("establishes first acquisition and supports an explicit referral boundary", () => {
    expect(acquisitionForEvent({ existingSource: null, existingOrigin: null, eventName: "listing_page_viewed", requestedSource: "facebook", listingToken: "newToken_123" })).toEqual({ source: "facebook", origin: "newToken_123", changed: true });
    expect(acquisitionForEvent({ ...existing, eventName: "listing_page_viewed", requestedSource: "referral", explicitBoundary: true })).toEqual({ source: "referral", origin: "newToken_123", changed: true });
  });
});