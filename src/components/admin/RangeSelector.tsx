import Link from "next/link";
import { ADMIN_RANGES, RANGE_LABELS, type AdminRange } from "@/lib/admin-analytics";

export function RangeSelector({ range }: { range: AdminRange }) {
  return <nav className="mc-ranges" aria-label="Analytics date range">
    {ADMIN_RANGES.map(value => <Link key={value} href={`/admin?range=${value}`} aria-current={range === value ? "page" : undefined}>{RANGE_LABELS[value]}</Link>)}
  </nav>;
}