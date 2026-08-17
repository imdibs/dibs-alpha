import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrCreateConversation, getPublicListing } = vi.hoisted(() => ({ getOrCreateConversation: vi.fn(), getPublicListing: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn().mockResolvedValue({ id: "buyer-1" }) }));
vi.mock("@/lib/marketplace", () => ({ getOrCreateConversation }));
vi.mock("@/lib/public-listings", () => ({ getPublicListing }));
import { POST } from "./route";

const token = "7xK92pAb_Cde";
describe("POST public listing contact", () => {
  beforeEach(() => { vi.clearAllMocks(); getPublicListing.mockResolvedValue({ id: "listing-1", seller_id: "seller-1", status: "active" }); getOrCreateConversation.mockResolvedValue({ id: "conversation-1" }); });

  it("carries validated anonymous attribution into conversation creation", async () => {
    const request = new Request("https://dibs.chat", { method: "POST", headers: { cookie: `dibs_visitor=550e8400-e29b-41d4-a716-446655440000; dibs_attribution=550e8400-e29b-41d4-a716-446655440001; dibs_origin_listing=${token}; dibs_acquisition_source=facebook` } });
    expect((await POST(request, { params: Promise.resolve({ token }) })).status).toBe(201);
    expect(getOrCreateConversation).toHaveBeenCalledWith("listing-1", "buyer-1", { visitorId: "550e8400-e29b-41d4-a716-446655440000", attributionToken: "550e8400-e29b-41d4-a716-446655440001", originListingToken: token, source: "facebook" });
  });

  it("drops malformed attribution without breaking contact", async () => {
    const request = new Request("https://dibs.chat", { method: "POST", headers: { cookie: "dibs_visitor=evil; dibs_attribution=evil; dibs_acquisition_source=evil" } });
    expect((await POST(request, { params: Promise.resolve({ token }) })).status).toBe(201);
    expect(getOrCreateConversation).toHaveBeenCalledWith("listing-1", "buyer-1", { visitorId: null, attributionToken: null, originListingToken: null, source: null });
  });
});