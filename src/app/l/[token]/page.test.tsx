import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ getPublicListing: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/public-listings", () => ({ getPublicListing: mocks.getPublicListing, publicListingUrl: vi.fn(() => "https://app.dibs.chat/l/7xK92pAb_Cde") }));
vi.mock("@/components/PublicListingActions", () => ({ PublicListingActions: () => <button>Ask Dibs about this</button> }));
import PublicListingPage from "./page";

describe("public listing page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows active listing title, price, location, and photos without authentication", async () => {
    mocks.getPublicListing.mockResolvedValue({ id: "listing-1", seller_id: "seller-1", title: "Water bottle", description: "Good condition", price_cents: 10000, condition: "good", city: "Miami", image_urls: ["https://images.example/one.jpg", "https://images.example/two.jpg"], status: "active", public_token: "7xK92pAb_Cde" });
    const html = renderToStaticMarkup(await PublicListingPage({ params: Promise.resolve({ token: "7xK92pAb_Cde" }) }));
    expect(html).toContain("Water bottle");
    expect(html).toContain("$100");
    expect(html).toContain("Miami");
    expect(html.match(/<img/g)).toHaveLength(2);
    expect(html).not.toContain("seller-1");
  });

  it.each(["invalid-token", "7xK92pAb_Cde"])("returns a real 404 for unavailable token %s", async token => {
    mocks.getPublicListing.mockResolvedValue(null);
    await expect(PublicListingPage({ params: Promise.resolve({ token }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});