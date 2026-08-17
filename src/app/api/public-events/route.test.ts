import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordProductEvent, getPublicListing } = vi.hoisted(() => ({ recordProductEvent: vi.fn(), getPublicListing: vi.fn() }));
vi.mock("@/lib/analytics", async () => ({ PUBLIC_EVENT_NAMES: ["listing_share_link_generated", "listing_page_viewed", "listing_cta_clicked"], recordProductEvent }));
vi.mock("@/lib/public-listings", () => ({ getPublicListing }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn().mockResolvedValue({ id: "user-1" }) }));

import { POST } from "./route";
import { resetPublicEventRateLimitForTests } from "@/lib/public-event-rate-limit";

const token = "7xK92pAb_Cde";
const visitor = "550e8400-e29b-41d4-a716-446655440000";
const attribution = "550e8400-e29b-41d4-a716-446655440001";
function request(body: unknown, cookie = "") {
  return new Request("https://dibs.chat/api/public-events", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
}

describe("POST /api/public-events", () => {
  beforeEach(() => { vi.clearAllMocks(); resetPublicEventRateLimitForTests(); getPublicListing.mockResolvedValue({ id: "listing-1", public_token: token }); });

  it("persists valid events and preserves validated tracking/acquisition cookies", async () => {
    const response = await POST(request({ eventName: "listing_cta_clicked", listingToken: token, source: "marketplace" }, `dibs_visitor=${visitor}; dibs_attribution=${attribution}; dibs_origin_listing=${token}; dibs_acquisition_source=whatsapp`));
    expect(response.status).toBe(200);
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ visitorId: visitor, attributionToken: attribution, source: "marketplace", metadata: { acquisitionSource: "whatsapp" } }));
    expect(response.headers.get("set-cookie")).toContain("dibs_acquisition_source=whatsapp");
  });

  it("regenerates malformed tracking cookies before persistence", async () => {
    await POST(request({ eventName: "listing_page_viewed", listingToken: token, source: "public_share" }, "dibs_visitor=evil; dibs_attribution=" + "x".repeat(101)));
    const event = recordProductEvent.mock.calls[0][0];
    expect(event.visitorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.attributionToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    { eventName: "database_dump", listingToken: token },
    { eventName: "listing_page_viewed", listingToken: "../../private" },
    { eventName: "listing_page_viewed", listingToken: token, metadata: { arbitrary: true } },
    { eventName: "listing_page_viewed", listingToken: token, source: "anything" },
  ])("rejects malformed or non-allowlisted payloads", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(recordProductEvent).not.toHaveBeenCalled();
  });

  it("returns a controlled failure when persistence fails", async () => {
    recordProductEvent.mockRejectedValueOnce(new Error("db unavailable"));
    expect((await POST(request({ eventName: "listing_page_viewed", listingToken: token }))).status).toBe(503);
  });

  it("rejects declared oversized bodies before persistence", async () => {
    const oversized = request({ eventName: "listing_page_viewed", listingToken: token });
    oversized.headers.set("content-length", "4097");
    expect((await POST(oversized)).status).toBe(413);
    expect(recordProductEvent).not.toHaveBeenCalled();
  });
});