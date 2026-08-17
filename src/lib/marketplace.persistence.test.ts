import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signal: null as Record<string, unknown> | null }));
const recordProductEvent = vi.hoisted(() => vi.fn());
vi.mock("./analytics", () => ({ recordProductEvent }));
vi.mock("./db", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "messages") return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: "message-1" }, error: null }) }) }) };
      if (table === "deal_signals") return { insert: async (value: Record<string, unknown>) => { state.signal = value; return { error: null }; } };
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));
import { persistParticipantMessage } from "./marketplace";

describe("automatic deal signal persistence", () => {
  beforeEach(() => { state.signal = null; recordProductEvent.mockReset(); recordProductEvent.mockResolvedValue(undefined); });

  it("persists classified conversation text only as possible auditable evidence", async () => {
    await persistParticipantMessage({ conversation: { id: "conversation-1", listing_id: "listing-1", buyer_id: "buyer-1", seller_id: "seller-1" }, senderId: "buyer-1", body: "payment sent and I picked it up" });
    expect(state.signal).toMatchObject({ conversation_id: "conversation-1", status: "possible", source: "conversation_classification", reported_by: "buyer-1", evidence: { statement: "payment sent and I picked it up", messageId: "message-1" } });
    expect(recordProductEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "deal_signal_detected", metadata: { status: "possible", confidence: 0.7 } }));
  });
});