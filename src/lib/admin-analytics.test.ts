import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ rpc: state.rpc }) }));
import { getDealAnalytics, getMarketplaceFunnel, getMarketplaceOverview, parseAdminRange, zeroSafePercentage } from "./admin-analytics";

const metric = { value: 0, periodCount: 0, previousCount: 0, change: 0, changePercent: 0 };

describe("admin analytics adapter", () => {
  beforeEach(() => state.rpc.mockReset());

  it("accepts supported ranges and safely defaults invalid input", () => {
    expect([parseAdminRange("today"), parseAdminRange("7d"), parseAdminRange("30d"), parseAdminRange("all")]).toEqual(["today", "7d", "30d", "all"]);
    expect(parseAdminRange("quarter")).toBe("7d");
    expect(parseAdminRange(["7d"])).toBe("7d");
  });

  it("calls the aggregation RPC with the selected date range", async () => {
    state.rpc.mockResolvedValue({ data: { users: metric, listings: metric, active_listings: metric, conversations: metric, introductions: metric, deals: metric, gmv: metric }, error: null });
    await getMarketplaceOverview("30d");
    expect(state.rpc).toHaveBeenCalledWith("admin_marketplace_overview", { requested_range: "30d" });
  });

  it("supports an empty database without NaN funnel math", async () => {
    state.rpc.mockResolvedValue({ data: [{ label: "Users", count: 0, conversionPercent: 0 }], error: null });
    await expect(getMarketplaceFunnel("all")).resolves.toEqual([{ label: "Users", count: 0, conversionPercent: 0 }]);
    expect(zeroSafePercentage(4, 0)).toBe(0);
    expect(zeroSafePercentage(1, 3)).toBe(33.3);
  });

  it("preserves canonical GMV cents returned by PostgreSQL", async () => {
    state.rpc.mockResolvedValue({ data: { totalDeals: 2, gmvCents: 12345, averageDealPriceCents: 6173, dealConversionPercent: 50, averageDaysToDeal: 2.5, categories: [] }, error: null });
    await expect(getDealAnalytics("7d")).resolves.toMatchObject({ totalDeals: 2, gmvCents: 12345 });
  });

  it("rejects malformed RPC data rather than displaying fake zeros", async () => {
    state.rpc.mockResolvedValue({ data: {}, error: null });
    await expect(getMarketplaceOverview()).rejects.toThrow("Invalid admin analytics response");
  });
});