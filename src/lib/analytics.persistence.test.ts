import { beforeEach, describe, expect, it, vi } from "vitest";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ from: (table: string) => { expect(table).toBe("product_events"); return { insert }; } }) }));
import { recordProductEvent } from "./analytics";

describe("recordProductEvent persistence", () => {
  beforeEach(() => { insert.mockReset(); insert.mockResolvedValue({ error: null }); });

  it("maps authoritative event relationships to the database row", async () => {
    await recordProductEvent({ eventName: "user_activated", userId: "user-1", listingId: "listing-1", conversationId: "conversation-1", visitorId: "visitor-1", attributionToken: "attribution-1", source: "referral", metadata: { stage: "activation" } });
    expect(insert).toHaveBeenCalledWith({ event_name: "user_activated", user_id: "user-1", listing_id: "listing-1", conversation_id: "conversation-1", visitor_id: "visitor-1", attribution_token: "attribution-1", source: "referral", metadata: { stage: "activation" } });
  });

  it("surfaces database failures and rejects oversized metadata before insertion", async () => {
    insert.mockResolvedValueOnce({ error: { message: "failure" } });
    await expect(recordProductEvent({ eventName: "user_activated" })).rejects.toThrow("Could not record product event");
    await expect(recordProductEvent({ eventName: "user_activated", metadata: { value: "x".repeat(2001) } })).rejects.toThrow("too large");
  });
});