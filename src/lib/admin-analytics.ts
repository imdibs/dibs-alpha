import { z } from "zod";
import { db } from "./db";

export const ADMIN_RANGES = ["today", "7d", "30d", "all"] as const;
export type AdminRange = typeof ADMIN_RANGES[number];
export const RANGE_LABELS: Record<AdminRange, string> = { today: "Today", "7d": "7 days", "30d": "30 days", all: "All time" };

export function parseAdminRange(value: string | string[] | undefined): AdminRange {
  return typeof value === "string" && (ADMIN_RANGES as readonly string[]).includes(value) ? value as AdminRange : "7d";
}

export function zeroSafePercentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round(numerator / denominator * 1000) / 10;
}

const nullableNumber = z.number().nullable();
const metricSchema = z.object({ value: z.number(), periodCount: z.number(), previousCount: nullableNumber, change: nullableNumber, changePercent: nullableNumber });
const overviewSchema = z.object({ users: metricSchema, listings: metricSchema, active_listings: metricSchema, conversations: metricSchema, introductions: metricSchema, deals: metricSchema, gmv: metricSchema });
const funnelSchema = z.array(z.object({ label: z.string(), count: z.number(), conversionPercent: z.number() }));
const breakdownSchema = z.array(z.object({ label: z.string(), count: z.number() }));
const supplySchema = z.object({
  byCategory: breakdownSchema, byLocation: breakdownSchema, byStatus: breakdownSchema,
  newestListings: z.array(z.object({ title: z.string(), priceCents: z.number(), category: z.string(), location: z.string(), createdAt: z.string() })),
});
const dealSchema = z.object({ totalDeals: z.number(), gmvCents: z.number(), averageDealPriceCents: z.number(), dealConversionPercent: z.number(), averageDaysToDeal: nullableNumber,
  categories: z.array(z.object({ label: z.string(), deals: z.number(), gmvCents: z.number() })) });
const timelineSchema = z.array(z.object({ date: z.string(), users: z.number(), listings: z.number(), conversations: z.number(), introductions: z.number(), deals: z.number() }));

export type MarketplaceOverview = z.infer<typeof overviewSchema>;
export type MarketplaceFunnel = z.infer<typeof funnelSchema>;
export type SupplyAnalytics = z.infer<typeof supplySchema>;
export type DealAnalytics = z.infer<typeof dealSchema>;
export type GrowthTimeline = z.infer<typeof timelineSchema>;

async function analyticsRpc<T>(name: string, schema: z.ZodType<T>, range?: AdminRange): Promise<T> {
  const result = await db().rpc(name, range ? { requested_range: range } : undefined);
  if (result.error) throw new Error(`Could not load admin analytics: ${name}`);
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) throw new Error(`Invalid admin analytics response: ${name}`);
  return parsed.data;
}

export function getMarketplaceOverview(range: AdminRange = "7d") { return analyticsRpc("admin_marketplace_overview", overviewSchema, range); }
export function getMarketplaceFunnel(range: AdminRange = "7d") { return analyticsRpc("admin_marketplace_funnel", funnelSchema, range); }
export function getSupplyAnalytics() { return analyticsRpc("admin_supply_analytics", supplySchema); }
export function getDealAnalytics(range: AdminRange = "7d") { return analyticsRpc("admin_deal_analytics", dealSchema, range); }
export function getGrowthTimeline(range: AdminRange = "7d") { return analyticsRpc("admin_growth_timeline", timelineSchema, range); }