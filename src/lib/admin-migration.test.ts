import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/014_admin_marketplace_analytics.sql", import.meta.url), "utf8").toLowerCase();

describe("admin marketplace analytics migration", () => {
  it("uses canonical rows and deal prices, not product events or deal signals", () => {
    expect(sql).toContain("from users");
    expect(sql).toContain("from listings");
    expect(sql).toContain("from conversations");
    expect(sql).toContain("from deals");
    expect(sql).toContain("sum(agreed_price_cents)");
    expect(sql).not.toContain("from product_events");
    expect(sql).not.toContain("from deal_signals");
  });

  it("deduplicates funnel users and uses the strict introduction predicate", () => {
    expect(sql.match(/count\(distinct c\.id\)/g)?.length).toBe(6);
    for (const predicate of ["connection_status in ('connected', 'completed')", "provider_group_type = 'group'", "provider_space_id is not null", "provider_line is not null", "buyer_provider_identity is not null", "seller_provider_identity is not null", "provider_introduction_message_id is not null", "connected_at is not null"]) expect(sql).toContain(predicate);
  });

  it("uses New York calendar boundaries and permits only the service role", () => {
    expect(sql).toContain("america/new_york");
    expect(sql).toContain("requested_range = 'today'");
    expect(sql).toContain("requested_range = '7d'");
    expect(sql).toContain("requested_range = '30d'");
    expect(sql).toContain("requested_range = 'all'");
    expect(sql).toContain("revoke all on function admin_marketplace_overview(text) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function admin_marketplace_overview(text) to service_role");
  });

  it("aggregates timeline counts before building the JSON array", () => {
    const timeline = sql.match(/create or replace function admin_growth_timeline[\s\S]*?\$\$;/)?.[0] || "";
    expect(timeline).toContain("daily_counts as (");
    expect(timeline).toContain("from daily_counts;");
    expect(timeline.slice(timeline.indexOf("select coalesce(jsonb_agg"))).not.toContain("count(*) filter");
  });
});