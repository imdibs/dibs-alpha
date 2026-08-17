import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureDibsError, capturePostHog, sanitizePostHogProperties, setPostHogClientForTests } from "./posthog";

const userId = "550e8400-e29b-41d4-a716-446655440000";
const capture = vi.fn();

describe("PostHog analytics privacy boundary", () => {
  beforeEach(() => { capture.mockReset(); setPostHogClientForTests({ capture }); });
  afterEach(() => setPostHogClientForTests(undefined));

  it("sends the exact event name, safe properties, and internal UUID", () => {
    capturePostHog({ event: "listing_created", distinctId: userId, properties: { listing_id: "listing-1", category: "electronics", city: "Miami", price_cents: 2500, seller_or_buyer_role: "seller" } });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: userId, event: "listing_created", properties: expect.objectContaining({ category: "electronics", city: "Miami", price_cents: 2500, $process_person_profile: false }) }));
  });

  it("drops phone numbers, emails, raw messages, AI text, photos, and unknown properties", () => {
    const properties = sanitizePostHogProperties("listing_created", {
      city: "+1 (305) 555-0123", category: "seller@example.com", listing_id: "listing-1",
      phone: "+13055550123", email: "seller@example.com", message: "raw buyer message",
      conversation_history: "raw AI conversation", photo: "data:image/png;base64,secret", image_urls: "https://private/photo.jpg",
    });
    expect(properties).toEqual({ listing_id: "listing-1" });
  });

  it("does not throw when capture fails", () => {
    capture.mockImplementation(() => { throw new Error("network secret seller@example.com"); });
    expect(() => capturePostHog({ event: "message_sent", distinctId: userId, properties: { channel: "web", message_kind: "participant", direction: "outbound" } })).not.toThrow();
  });

  it("does not wait for a timed-out capture", () => {
    capture.mockReturnValue(new Promise(() => undefined));
    const started = performance.now();
    capturePostHog({ event: "product_search", distinctId: userId, properties: { city: "Miami", intent: "buy", channel: "web" } });
    expect(performance.now() - started).toBeLessThan(25);
  });

  it("is a no-op when PostHog configuration is missing", () => {
    setPostHogClientForTests(null);
    expect(() => capturePostHog({ event: "user_signed_up", distinctId: userId })).not.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });

  it("reports sanitized error categories without exception details", () => {
    captureDibsError({ distinctId: userId, subsystem: "ai", errorType: "provider failed for seller@example.com", retryable: true });
    const payload = capture.mock.calls[0][0];
    expect(payload.properties).toMatchObject({ subsystem: "ai", error_type: "unknown", retryable: true });
    expect(JSON.stringify(payload)).not.toContain("exception");
    expect(JSON.stringify(payload)).not.toContain("seller@example.com");
  });
});