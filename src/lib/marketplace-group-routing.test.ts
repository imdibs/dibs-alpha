import { describe, expect, it, vi } from "vitest";
import { routeMarketplaceGroupMessage, type GroupConversation, type MarketplaceGroupRoutingRepository } from "./marketplace-group-routing";

const conversation: GroupConversation = {
  id: "conversation-1", listing_id: "listing-1", buyer_id: "buyer-1", seller_id: "seller-1",
  provider_space_id: "group-1", provider_line: "+13055550000", buyer_provider_identity: "+13055550111",
  seller_provider_identity: "seller@example.com", connection_status: "connected",
};
const message = { messageId: "provider-1", conversationId: "group-1", providerLine: "+13055550000", senderId: "+13055550111", occurredAt: "2026-08-19T00:00:00Z", text: "would you take $350?", attachments: [] };

function repository(): MarketplaceGroupRoutingRepository {
  return {
    find: vi.fn(async () => conversation), persistMessage: vi.fn(async () => ({ id: "message-1" })),
    previousOffer: vi.fn(async () => null), persistEvents: vi.fn(async () => undefined),
  };
}

describe("marketplace group inbound routing", () => {
  it("routes by exact space and owning line, validates participant, and persists semantic events", async () => {
    const repo = repository();
    expect(await routeMarketplaceGroupMessage(message, repo)).toEqual({ handled: true, conversation, senderId: "buyer-1" });
    expect(repo.find).toHaveBeenCalledWith("group-1", "+13055550000");
    expect(repo.persistMessage).toHaveBeenCalledWith(expect.objectContaining({ senderId: "buyer-1", providerMessageId: "provider-1" }));
    expect(repo.persistEvents).toHaveBeenCalledWith(expect.objectContaining({ events: expect.arrayContaining([expect.objectContaining({ type: "offer_made", priceCents: 35000 })]) }));
  });
  it.each([
    ["@Dibs, what was the price?", "what was the price?"],
    ["Dibs can you help?", "can you help?"],
  ])("recognizes strict leading direct address: %s", async (text, directText) => {
    expect(await routeMarketplaceGroupMessage({ ...message, text }, repository())).toMatchObject({ handled: true, directText });
  });
  it.each(["what does Dibs think?", "undibs this", "Dibs"])("does not directly address Dibs for: %s", async text => {
    expect(await routeMarketplaceGroupMessage({ ...message, text }, repository())).not.toHaveProperty("directText");
  });
  it("suppresses messages sent by the owning provider line", async () => {
    const repo = repository();
    expect(await routeMarketplaceGroupMessage({ ...message, senderId: "+13055550000" }, repo)).toEqual({ handled: true });
    expect(repo.persistMessage).not.toHaveBeenCalled();
  });
  it("rejects senders not in the persisted buyer/seller identities", async () => {
    await expect(routeMarketplaceGroupMessage({ ...message, senderId: "+13055550999" }, repository())).rejects.toThrow("not a persisted participant");
  });
  it("does not claim private or unknown spaces", async () => {
    const repo = repository(); vi.mocked(repo.find).mockResolvedValue(null);
    expect(await routeMarketplaceGroupMessage(message, repo)).toEqual({ handled: false });
    expect(await routeMarketplaceGroupMessage({ ...message, providerLine: undefined }, repo)).toEqual({ handled: false });
  });
});