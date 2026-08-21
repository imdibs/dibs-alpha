import type { MarketplaceFunnel } from "@/lib/admin-analytics";

export function Funnel({ stages }: { stages: MarketplaceFunnel }) {
  if (stages.length === 0 || stages.every(stage => stage.count === 0)) {
    return <div className="mc-empty-state"><strong>No cohort activity yet</strong><p>The funnel will appear as users in this signup cohort move through the marketplace.</p></div>;
  }
  return <div className="mc-funnel">{stages.map(stage => <div className="mc-funnel-row" key={stage.label}>
    <div><strong>{stage.label}</strong><span>{stage.count.toLocaleString()} · {stage.conversionPercent}% of users</span></div>
    <div className="mc-track"><i style={{ width: `${Math.min(100, stage.conversionPercent)}%` }}/></div>
  </div>)}</div>;
}