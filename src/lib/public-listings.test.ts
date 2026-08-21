import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const maybeSingle = vi.hoisted(() => vi.fn());
const statusEq = vi.hoisted(() => vi.fn(() => ({ maybeSingle })));
const tokenEq = vi.hoisted(() => vi.fn(() => ({ eq: statusEq })));
vi.mock("./db", () => ({ db: () => ({ from: () => ({ select: () => ({ eq: tokenEq }) }) }) }));
import { getPublicListing, publicListingUrl } from "./public-listings";
import { publicTokenSchema } from "./validation";

describe("public listing URLs", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });
  beforeEach(() => vi.clearAllMocks());

  it("builds a stable URL from an opaque token without exposing a listing UUID", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test/";
    const token = "7xK92pAb_Cde";
    expect(publicTokenSchema.parse(token)).toBe(token);
    expect(publicListingUrl(token)).toBe("https://staging.example.test/l/7xK92pAb_Cde");
    expect(publicListingUrl(token)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  it("builds the verified production URL on app.dibs.chat", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.dibs.chat";
    expect(publicListingUrl("7xK92pAb_Cde")).toBe("https://app.dibs.chat/l/7xK92pAb_Cde");
  });

  it("rejects malformed public tokens", () => {
    expect(() => publicListingUrl("../../private")).toThrow();
  });

  it("requires an explicitly configured site origin", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => publicListingUrl("7xK92pAb_Cde")).toThrow("NEXT_PUBLIC_SITE_URL must be configured as an HTTP(S) origin");
  });

  it("rejects a configured URL that is not an origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test/app";
    expect(() => publicListingUrl("7xK92pAb_Cde")).toThrow("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin");
  });

  it("resolves the correct active listing by public token without private user fields", async () => {
    const listing = { id: "listing-1", seller_id: "seller-1", title: "Water bottle", description: "Good condition", price_cents: 10000, condition: "good", city: "Miami", image_urls: ["photo"], status: "active", public_token: "7xK92pAb_Cde" };
    maybeSingle.mockResolvedValue({ data: listing, error: null });
    expect(await getPublicListing("7xK92pAb_Cde")).toEqual(listing);
    expect(tokenEq).toHaveBeenCalledWith("public_token", "7xK92pAb_Cde");
    expect(statusEq).toHaveBeenCalledWith("status", "active");
    expect(listing).not.toHaveProperty("imessage_address");
  });

  it("rejects an invalid token without querying listings", async () => {
    expect(await getPublicListing("invalid")).toBeNull();
    expect(tokenEq).not.toHaveBeenCalled();
  });

  it("does not expose a draft listing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await getPublicListing("7xK92pAb_Cde")).toBeNull();
    expect(statusEq).toHaveBeenCalledWith("status", "active");
  });
});