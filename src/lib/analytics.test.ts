import { describe, expect, it } from "vitest";
import { cleanSource, newTrackingToken, postHogEventsForProductEvent, PUBLIC_EVENT_NAMES } from "./analytics";

describe("first-party attribution", () => {
  it("uses allowlisted public event names and opaque first-party tokens", () => {
    expect(PUBLIC_EVENT_NAMES).toEqual(["listing_share_link_generated", "listing_page_viewed", "listing_cta_clicked"]);
    expect(newTrackingToken()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("normalizes untrusted source labels without retaining arbitrary text", () => {
    expect(cleanSource(" WhatsApp Group / Miami ")).toBeNull();
    expect(cleanSource("public_share")).toBe("public_share");
    expect(cleanSource(" ")).toBeNull();
  });
});

describe("PostHog product event mapping", () => {
  it("maps existing authoritative onboarding events without contact data", () => {
    const events = postHogEventsForProductEvent({ eventName: "alpha_onboarding_accepted", userId: "550e8400-e29b-41d4-a716-446655440000", source: "website", metadata: { city: "Miami", cohort: "miami_alpha" } });
    expect(events).toEqual([
      { event: "user_signed_up", distinctId: "550e8400-e29b-41d4-a716-446655440000", properties: { source: "website", city: "Miami", onboarding_method: "website" } },
      { event: "onboarding_started", distinctId: "550e8400-e29b-41d4-a716-446655440000", properties: { source: "website", onboarding_method: "website" } },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/phone|email|message|photo/i);
  });

  it("does not forward unmapped first-party metadata", () => {
    expect(postHogEventsForProductEvent({ eventName: "unknown_internal_event", metadata: { message: "private", email: "person@example.com" } })).toEqual([]);
  });

  it("maps a first reply separately from meaningful onboarding completion", () => {
    expect(postHogEventsForProductEvent({ eventName: "alpha_user_replied", userId: "user-1" })).toEqual([
      { event: "first_message_received", distinctId: "user-1", properties: { channel: "imessage", message_kind: "onboarding_reply" } },
    ]);
    expect(postHogEventsForProductEvent({ eventName: "onboarding_completed", userId: "user-1", metadata: { direction: "buy" } })).toEqual([
      { event: "onboarding_completed", distinctId: "user-1", properties: { source: undefined, onboarding_method: "imessage" } },
    ]);
  });
});