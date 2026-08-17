import { beforeEach, describe, expect, it, vi } from "vitest";

const { insert, recordProductEvent, getPublicListing, maybeSingle } = vi.hoisted(() => ({ insert: vi.fn(), recordProductEvent: vi.fn(), getPublicListing: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }), insert }) }) }));
vi.mock("@/lib/auth", () => ({ hashPassword: vi.fn().mockResolvedValue("hash"), makeSession: vi.fn().mockReturnValue("session"), sessionCookie: "dibs_session", verifyPassword: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ recordProductEvent }));
vi.mock("@/lib/public-listings", () => ({ getPublicListing }));
import { POST } from "./route";

describe("POST /api/session attribution handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null });
    insert.mockReturnValue({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "user-1" }, error: null }) }) });
    getPublicListing.mockResolvedValue({ id: "listing-1" });
    recordProductEvent.mockResolvedValue(undefined);
  });

  it("joins activation to the anonymous visitor and originating listing", async () => {
    const cookie = "dibs_visitor=550e8400-e29b-41d4-a716-446655440000; dibs_attribution=550e8400-e29b-41d4-a716-446655440001; dibs_origin_listing=7xK92pAb_Cde; dibs_acquisition_source=referral";
    const response = await POST(new Request("https://dibs.chat/api/session", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ name: "Miami Buyer", email: "buyer@example.com", password: "password123", city: "Miami" }) }));
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ activated_at: expect.any(String), acquisition_source: "referral", originating_listing_id: "listing-1", acquisition_at: expect.any(String) }));
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "shared_listing_user_activated", userId: "user-1", listingId: "listing-1", visitorId: "550e8400-e29b-41d4-a716-446655440000", attributionToken: "550e8400-e29b-41d4-a716-446655440001", source: "referral" }));
  });
});