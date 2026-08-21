import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMarketplaceOverview: vi.fn(), getMarketplaceFunnel: vi.fn(), getSupplyAnalytics: vi.fn(),
  getDealAnalytics: vi.fn(), getGrowthTimeline: vi.fn(),
}));
vi.mock("@/lib/admin-analytics", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/admin-analytics")>(),
  ...mocks,
}));
vi.mock("@/components/admin/RangeSelector", () => ({ RangeSelector: () => React.createElement("nav") }));
import AdminPage from "./page";

describe("admin dashboard", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockResolvedValue({});
  });

  it("renders an admin-facing error when an analytics RPC fails", async () => {
    mocks.getDealAnalytics.mockRejectedValue(new Error("Could not load admin analytics: admin_deal_analytics"));
    const html = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({ range: "7d" }) }));
    expect(html).toContain("Admin analytics are unavailable");
    expect(html).toContain("Could not load admin analytics: admin_deal_analytics");
    expect(html).toContain("role=\"alert\"");
  });
});