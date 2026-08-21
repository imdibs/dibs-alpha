import React from "react";
import { Breakdown } from "@/components/admin/Breakdown";
import { FounderPriorities } from "@/components/admin/FounderPriorities";
import { Funnel } from "@/components/admin/Funnel";
import { GrowthTimeline } from "@/components/admin/GrowthTimeline";
import { MetricCards } from "@/components/admin/MetricCards";
import { RangeSelector } from "@/components/admin/RangeSelector";
import { getDealAnalytics, getGrowthTimeline, getMarketplaceFunnel, getMarketplaceOverview, getSupplyAnalytics, parseAdminRange, RANGE_LABELS } from "@/lib/admin-analytics";

export const dynamic = "force-dynamic";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ range?: string | string[] }> }) {
  const range = parseAdminRange((await searchParams).range);
  let analytics;
  try {
    analytics = await Promise.all([
      getMarketplaceOverview(range), getMarketplaceFunnel(range), getSupplyAnalytics(), getDealAnalytics(range), getGrowthTimeline(range),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown analytics error";
    return <>
      <header className="mc-header"><div><p className="mc-kicker">Founder dashboard · {RANGE_LABELS[range]}</p><h1>Dibs Mission Control</h1><p>Marketplace health and the next move that matters.</p></div><RangeSelector range={range}/></header>
      <section className="mc-section" role="alert"><div className="mc-empty-state"><strong>Admin analytics are unavailable</strong><p>{detail}. Confirm that migration 014 has been applied successfully, then reload this page.</p></div></section>
    </>;
  }
  const [overview, funnel, supply, deals, timeline] = analytics;
  return <>
    <header className="mc-header"><div><p className="mc-kicker">Founder dashboard · {RANGE_LABELS[range]}</p><h1>Dibs Mission Control</h1><p>Marketplace health and the next move that matters.</p></div><RangeSelector range={range}/></header>
    <MetricCards overview={overview}/>
    <FounderPriorities overview={overview} funnel={funnel} deals={deals}/>

    <section className="mc-section"><div className="mc-section-head"><div><p className="mc-kicker">Connection</p><h2>Marketplace Funnel</h2></div><p>How the selected signup cohort moves from joining Dibs to completing a deal.</p></div><Funnel stages={funnel}/></section>
    <section className="mc-section"><div className="mc-section-head"><div><p className="mc-kicker">Momentum</p><h2>Growth Timeline</h2></div><p>New canonical facts per New York calendar day.</p></div><GrowthTimeline points={timeline}/></section>
    <section className="mc-section"><div className="mc-section-head"><div><p className="mc-kicker">Supply</p><h2>Supply Intelligence</h2></div><p>Current snapshot across all listings.</p></div>
      <div className="mc-breakdowns"><Breakdown title="Category" rows={supply.byCategory}/><Breakdown title="Location" rows={supply.byLocation}/><Breakdown title="Status" rows={supply.byStatus}/></div>
      <h3 className="mc-table-title">Newest listings</h3><div className="mc-table-wrap"><table><thead><tr><th>Title</th><th>Price</th><th>Category</th><th>Location</th><th>Created</th></tr></thead><tbody>
        {supply.newestListings.length === 0 ? <tr><td colSpan={5} className="mc-empty">No listings yet.</td></tr> : supply.newestListings.map((listing, index) => <tr key={`${listing.createdAt}-${index}`}><td><strong>{listing.title}</strong></td><td>{money.format(listing.priceCents / 100)}</td><td>{listing.category}</td><td>{listing.location}</td><td>{new Date(listing.createdAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}</td></tr>)}
      </tbody></table></div>
    </section>
    <section className="mc-section"><div className="mc-section-head"><div><p className="mc-kicker">Transactions · {RANGE_LABELS[range]}</p><h2>Deal Intelligence</h2></div><p>Confirmed deal rows only.</p></div>
      <div className="mc-deal-stats"><div><span>Total deals</span><strong>{deals.totalDeals.toLocaleString()}</strong></div><div><span>GMV</span><strong>{money.format(deals.gmvCents / 100)}</strong></div><div><span>Average price</span><strong>{money.format(deals.averageDealPriceCents / 100)}</strong></div><div><span>Deals / introductions</span><strong>{deals.dealConversionPercent}%</strong></div><div><span>Published → deal</span><strong>{deals.averageDaysToDeal === null ? "—" : `${deals.averageDaysToDeal}d`}</strong></div></div>
      <h3 className="mc-table-title">Categories creating deals</h3><div className="mc-table-wrap"><table><thead><tr><th>Category</th><th>Deals</th><th>GMV</th></tr></thead><tbody>{deals.categories.length === 0 ? <tr><td colSpan={3} className="mc-empty">No deals in this period.</td></tr> : deals.categories.map(category => <tr key={category.label}><td><strong>{category.label}</strong></td><td>{category.deals}</td><td>{money.format(category.gmvCents / 100)}</td></tr>)}</tbody></table></div>
    </section>
  </>;
}