import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectBuyerToSeller, type MarketplaceConnection, type MarketplaceConnectionRepository } from "./marketplace-connection";

const connection = (overrides: Partial<MarketplaceConnection> = {}): MarketplaceConnection => ({
  id: "conversation-1", listing_id: "listing-1", buyer_id: "buyer-1", seller_id: "seller-1",
  provider_space_id: null, provider_line: null, provider_group_type: null,
  buyer_provider_identity: null, seller_provider_identity: null, connection_status: "group_pending",
  provider_creation_key: null, provider_introduction_message_id: null,
  listing: { id: "listing-1", title: "[ALPHA TEST] Road Bike", price_cents: 35000, status: "active" },
  buyer: { id: "buyer-1", imessage_address: "+13055550111" },
  seller: { id: "seller-1", imessage_address: "+13055550222" }, ...overrides,
});

describe("durable marketplace connection", () => {
  let current: MarketplaceConnection;
  let repository: MarketplaceConnectionRepository;
  let send: ReturnType<typeof vi.fn>;
  let provider: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    current = connection();
    send = vi.fn(async () => ({ id: "intro-1" }));
    provider = {
      create: vi.fn(async () => ({ id: "group-1", type: "group" as const, phone: "+13055550000", send })),
      get: vi.fn(async () => ({ id: "group-1", type: "group" as const, phone: "+13055550000", send })),
    };
    repository = {
      getOrCreate: vi.fn(async () => current),
      reserveGroupCreation: vi.fn(async (_id, key, buyer, seller) => { current = { ...current, connection_status: "group_creating", provider_creation_key: key, buyer_provider_identity: buyer, seller_provider_identity: seller }; return true; }),
      saveProviderGroup: vi.fn(async (_id, group) => { current = { ...current, connection_status: "group_created", provider_space_id: group.providerSpaceId, provider_line: group.providerLine, provider_group_type: "group" }; }),
      reserveIntroduction: vi.fn(async () => true),
      markConnected: vi.fn(async () => { current = { ...current, connection_status: "connected" }; }),
      markReconciliationRequired: vi.fn(async () => { current = { ...current, connection_status: "reconciliation_required" }; }),
    };
  });

  it("creates one group, sends one introduction, and persists delivery", async () => {
    const result = await connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Road Bike for $350"));
    expect(repository.markConnected).toHaveBeenCalledWith("conversation-1", "intro-1");
    expect(result).toMatchObject({ providerSpaceId: "group-1", reused: false });
  });

  it("reuses an already connected group without creating or introducing again", async () => {
    current = connection({ connection_status: "connected", provider_space_id: "group-1", provider_line: "+13055550000", provider_group_type: "group" });
    const result = await connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" });
    expect(result.reused).toBe(true); expect(provider.create).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });

  it("does not reuse a connected group from a previous provider line", async () => {
    current = connection({ connection_status: "connected", provider_space_id: "old-group", provider_line: "+13055559999", provider_group_type: "group" });
    await expect(connectBuyerToSeller(
      { buyerId: "buyer-1", selectedListingId: "listing-1" },
      { repository, provider, configuredLine: "+13055550000" },
    )).rejects.toThrow("different provider line");
    expect(provider.create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not create when another attempt owns the reservation", async () => {
    vi.mocked(repository.reserveGroupCreation).mockResolvedValue(false);
    await expect(connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" })).rejects.toThrow("already in progress");
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("fails closed on missing identities and self-contact", async () => {
    current = connection({ buyer: { id: "buyer-1", imessage_address: null } });
    await expect(connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" })).rejects.toThrow("verified iMessage");
    current = connection({ seller_id: "buyer-1" });
    await expect(connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" })).rejects.toThrow("own listing");
  });

  it("marks ambiguous send failure for reconciliation and never retries blindly", async () => {
    send.mockRejectedValueOnce(new Error("timeout"));
    await expect(connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" })).rejects.toThrow("timeout");
    expect(repository.markReconciliationRequired).toHaveBeenCalled();
    current = connection({ connection_status: "reconciliation_required" });
    await expect(connectBuyerToSeller({ buyerId: "buyer-1", selectedListingId: "listing-1" }, { repository, provider, configuredLine: "+13055550000" })).rejects.toThrow("reconciliation");
  });
});