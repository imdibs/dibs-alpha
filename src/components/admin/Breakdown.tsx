type Row = { label: string; count: number };
export function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(0, ...rows.map(row => row.count));
  return <article className="mc-breakdown"><h3>{title}</h3>{rows.length === 0 ? <p className="mc-empty">No data yet.</p> : rows.map(row => <div className="mc-bar" key={row.label}>
    <div><span>{row.label}</span><strong>{row.count.toLocaleString()}</strong></div><i><b style={{ width: `${max ? row.count / max * 100 : 0}%` }}/></i>
  </div>)}</article>;
}