import type { MarketplaceOverview } from "@/lib/admin-analytics";

const primaryMetrics: Array<[keyof MarketplaceOverview, string, boolean]> = [
  ["users", "Users", false], ["listings", "Listings", false], ["introductions", "Introductions", false],
  ["deals", "Deals", false], ["gmv", "GMV", true],
];
const supportingMetrics: Array<[keyof MarketplaceOverview, string, boolean]> = [
  ["active_listings", "Active listings", false], ["conversations", "Conversations", false],
];
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function MetricCards({ overview }: { overview: MarketplaceOverview }) {
  const renderMetric = ([key, label, currency]: typeof primaryMetrics[number]) => {
    const metric = overview[key];
    const value = currency ? money.format(metric.value / 100) : metric.value.toLocaleString();
    const formattedChange = currency ? money.format(Math.abs(metric.change || 0) / 100) : Math.abs(metric.change || 0).toLocaleString();
    const change = metric.change === null
      ? `${currency ? money.format(metric.periodCount / 100) : metric.periodCount.toLocaleString()} all time`
      : `${metric.change >= 0 ? "+" : "−"}${formattedChange}${metric.changePercent === null ? "" : ` (${metric.changePercent >= 0 ? "+" : ""}${metric.changePercent}%)`} vs prior`;
    return <article className="mc-metric" key={key}><p>{label}<span>{key === "active_listings" ? "Current snapshot" : "All-time total"}</span></p><strong>{value}</strong><small className={metric.change !== null && metric.change < 0 ? "down" : ""}>{change}</small></article>;
  };
  return <section className="mc-metrics" aria-label="Marketplace totals">
    <div className="mc-primary-metrics">{primaryMetrics.map(renderMetric)}</div>
    <div className="mc-supporting-metrics" aria-label="Supporting marketplace totals">{supportingMetrics.map(renderMetric)}</div>
  </section>;
}