import { beforeEach, describe, expect, it, vi } from "vitest";

type Filter = [operation: string, column: string, value: unknown];
const state = vi.hoisted(() => ({
  counts: { users: 4, conversations: 2, listings: 5, deals: 1, active: 2, draft: 1, sold: 1 } as Record<string, number>,
  queries: [] as Array<{ table: string; filters: Filter[]; count?: string; head?: boolean }>,
}));

vi.mock("./db", () => ({
  db: () => ({
    from: (table: string) => ({
      select: (_columns: string, options: { count?: string; head?: boolean } = {}) => {
        const query = { table, filters: [] as Filter[], ...options };
        state.queries.push(query);
        const chain = {
          in(column: string, value: unknown) { query.filters.push(["in", column, value]); return chain; },
          eq(column: string, value: unknown) { query.filters.push(["eq", column, value]); return chain; },
          not(column: string, operation: string, value: unknown) { query.filters.push([`not:${operation}`, column, value]); return chain; },
          then(resolve: (value: { count: number; error: null }) => unknown) {
            const status = query.filters.find(filter => filter[1] === "status")?.[2];
            const key = table === "listings" && typeof status === "string" ? status : table;
            return Promise.resolve(resolve({ count: state.counts[key], error: null }));
          },
        };
        return chain;
      },
    }),
  }),
}));
import { getCoreAnalytics } from "./analytics";

describe("canonical core analytics", () => {
  beforeEach(() => { state.queries.length = 0; });

  it("counts each canonical row once and always returns the four primary metrics", async () => {
    await expect(getCoreAnalytics()).resolves.toEqual({
      total_users: 4, total_introductions: 2, total_listings: 5, total_deals: 1,
      active_listings: 2, draft_listings: 1, sold_listings: 1,
    });
    expect(state.queries.map(query => query.table)).toEqual(["users", "conversations", "listings", "deals", "listings", "listings", "listings"]);
    expect(state.queries.every(query => query.count === "exact" && query.head === true)).toBe(true);
    expect(state.queries.some(query => query.table === "product_events")).toBe(false);
  });

  it("counts only fully delivered connected groups as introductions", async () => {
    await getCoreAnalytics();
    const introduction = state.queries.find(query => query.table === "conversations")!;
    expect(introduction.filters).toEqual(expect.arrayContaining([
      ["in", "connection_status", ["connected", "completed"]],
      ["eq", "provider_group_type", "group"],
      ["not:is", "provider_space_id", null],
      ["not:is", "provider_line", null],
      ["not:is", "buyer_provider_identity", null],
      ["not:is", "seller_provider_identity", null],
      ["not:is", "provider_introduction_message_id", null],
      ["not:is", "connected_at", null],
    ]));
    expect(JSON.stringify(introduction.filters)).not.toContain("reconciliation_required");
    expect(JSON.stringify(introduction.filters)).not.toContain("failed");
  });
});