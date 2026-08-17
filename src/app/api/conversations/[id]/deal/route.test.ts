import { beforeEach, describe, expect, it, vi } from "vitest";

type Report = { reported_by: string; evidence: { reportedPriceCents: number } };
const state = vi.hoisted(() => ({ reports: [] as Report[], inserts: [] as Record<string, unknown>[], deals: [] as Record<string, unknown>[] }));

vi.mock("@/lib/auth", () => ({ currentUser: vi.fn().mockResolvedValue({ id: "seller-1" }) }));
vi.mock("@/lib/db", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "conversations") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "conversation-1", listing_id: "listing-1", buyer_id: "buyer-1", seller_id: "seller-1" } }) }) }) };
      if (table === "deals") return { upsert: (value: Record<string, unknown>) => { state.deals.push(value); return { select: () => ({ maybeSingle: async () => ({ data: { id: "deal-1" }, error: null }) }) }; } };
      if (table === "deal_signals") return {
        select: () => ({ eq: () => ({ in: async () => ({ data: state.reports, error: null }) }) }),
        insert: (value: Record<string, unknown>) => {
          state.inserts.push(value);
          if (value.status === "likely") {
            state.reports.push({ reported_by: value.reported_by as string, evidence: value.evidence as { reportedPriceCents: number } });
            return { select: () => ({ single: async () => ({ data: { status: "likely", evidence: value.evidence, confidence: 0.85 }, error: null }) }) };
          }
          return Promise.resolve({ error: null });
        },
      };
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));
import { POST } from "./route";

function request(price = 100) {
  return new Request("https://dibs.chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ price, evidence: "We completed pickup" }) });
}

describe("POST conversation deal report", () => {
  beforeEach(() => { state.reports.length = 0; state.inserts.length = 0; state.deals.length = 0; });

  it("records one participant report as likely without creating a deal", async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: "conversation-1" }) });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("likely");
    expect(state.deals).toHaveLength(0);
    expect(state.inserts[0]).toMatchObject({ status: "likely", source: "seller_report", reported_by: "seller-1" });
  });

  it("creates a canonical deal and confirmed audit signal for matching independent reports", async () => {
    state.reports.push({ reported_by: "buyer-1", evidence: { reportedPriceCents: 10000 } });
    const response = await POST(request(), { params: Promise.resolve({ id: "conversation-1" }) });
    expect((await response.json()).status).toBe("confirmed");
    expect(state.deals[0]).toMatchObject({ conversation_id: "conversation-1", agreed_price_cents: 10000 });
    expect(state.inserts[1]).toMatchObject({ status: "confirmed", source: "bilateral_confirmation", confidence: 1 });
  });

  it("does not confirm reports with different prices", async () => {
    state.reports.push({ reported_by: "buyer-1", evidence: { reportedPriceCents: 9000 } });
    expect((await (await POST(request(), { params: Promise.resolve({ id: "conversation-1" }) })).json()).status).toBe("likely");
    expect(state.deals).toHaveLength(0);
  });
});