import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMarketplaceOverview: vi.fn(), getMarketplaceFunnel: vi.fn(), getSupplyAnalytics: vi.fn(),
  getDealAnalytics: vi.fn(), getGrowthTimeline: vi.fn(), requireLocalAdmin: vi.fn(),
}));
vi.mock("@/lib/admin-analytics", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/admin-analytics")>(),
  ...mocks,
}));
vi.mock("@/lib/local-admin", () => ({ requireLocalAdmin: mocks.requireLocalAdmin }));
vi.mock("@/components/admin/RangeSelector", () => ({ RangeSelector: () => React.createElement("nav") }));
import AdminPage from "./page";

const metric = { value: 0, periodCount: 0, previousCount: 0, change: 0, changePercent: 0 };

describe("admin dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLocalAdmin.mockResolvedValue(undefined);
    mocks.getMarketplaceOverview.mockResolvedValue({
      users: metric, listings: metric, active_listings: metric, conversations: metric,
      introductions: metric, deals: metric, gmv: metric,
    });
    mocks.getMarketplaceFunnel.mockResolvedValue([]);
    mocks.getSupplyAnalytics.mockResolvedValue({ byCategory: [], byLocation: [], byStatus: [], newestListings: [] });
    mocks.getDealAnalytics.mockResolvedValue({ totalDeals: 0, gmvCents: 0, averageDealPriceCents: 0, dealConversionPercent: 0, averageDaysToDeal: null, categories: [] });
    mocks.getGrowthTimeline.mockResolvedValue([]);
  });

  it("queries every canonical analytics function after the local guard passes", async () => {
    const page = await AdminPage({ searchParams: Promise.resolve({ range: "30d" }) });
    expect(mocks.requireLocalAdmin).toHaveBeenCalledOnce();
    expect(mocks.getMarketplaceOverview).toHaveBeenCalledWith("30d");
    expect(mocks.getMarketplaceFunnel).toHaveBeenCalledWith("30d");
    expect(mocks.getSupplyAnalytics).toHaveBeenCalledOnce();
    expect(mocks.getDealAnalytics).toHaveBeenCalledWith("30d");
    expect(mocks.getGrowthTimeline).toHaveBeenCalledWith("30d");
    expect(JSON.stringify(page)).toContain("Selected signup cohort");
    expect(JSON.stringify(page)).toContain("Cohort counts can differ from the all-time headline totals.");
  });

  it("does not query analytics when the local guard rejects the request", async () => {
    mocks.requireLocalAdmin.mockRejectedValue(new Error("NEXT_NOT_FOUND"));
    await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
    for (const mock of [mocks.getMarketplaceOverview, mocks.getMarketplaceFunnel, mocks.getSupplyAnalytics, mocks.getDealAnalytics, mocks.getGrowthTimeline]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("renders an admin-facing error when an analytics RPC fails", async () => {
    mocks.getDealAnalytics.mockRejectedValue(new Error("Could not load admin analytics: admin_deal_analytics"));
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ range: "7d" }) }));
    expect(html).toContain("Admin analytics are unavailable");
    expect(html).toContain("Could not load admin analytics: admin_deal_analytics");
    expect(html).toContain("role=\"alert\"");
  });
});