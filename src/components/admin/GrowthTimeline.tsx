import type { GrowthTimeline as TimelineData } from "@/lib/admin-analytics";

const series = [["users", "Users"], ["listings", "Listings"], ["conversations", "Conversations"], ["introductions", "Introductions"], ["deals", "Deals"]] as const;
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export function GrowthTimeline({ points }: { points: TimelineData }) {
  const width = 900, height = 260, inset = 12;
  const max = Math.max(1, ...points.flatMap(point => series.map(([key]) => point[key])));
  const hasActivity = points.some(point => series.some(([key]) => point[key] > 0));
  const path = (key: typeof series[number][0]) => points.map((point, index) => `${index ? "L" : "M"}${inset + index * (width - inset * 2) / Math.max(1, points.length - 1)},${height - inset - point[key] / max * (height - inset * 2)}`).join(" ");
  return <div className="mc-chart">
    <div className="mc-legend">{series.map(([key, label]) => <span className={key} key={key}><i/>{label}</span>)}</div>
    {!hasActivity ? <div className="mc-empty-state"><strong>No activity in this period</strong><p>Choose a longer range or check back when new marketplace activity arrives.</p></div> : <>
      <svg role="img" aria-label="Daily marketplace growth" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, .5, 1].map(value => <line key={value} x1="0" x2={width} y1={inset + value * (height - inset * 2)} y2={inset + value * (height - inset * 2)}/>)}
        {series.map(([key]) => <path className={key} key={key} d={path(key)}/>)}
      </svg>
      <div className="mc-axis"><span>{shortDate(points[0].date)}</span><span>{shortDate(points.at(-1)?.date || points[0].date)}</span></div>
    </>}
  </div>;
}