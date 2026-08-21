import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundMessage } from "./messaging";
import type { MessagingSession } from "./marketplace";
import type { AiClient } from "./ai/types";
import type { MarketplaceGroupRoutingRepository } from "./marketplace-group-routing";

const mocks = vi.hoisted(() => ({
  activateOwnedDraftListing: vi.fn(), activeListingsForSeller: vi.fn(), createListingFromDraft: vi.fn(), deleteSellerDraftPhotos: vi.fn(), updateOwnedListing: vi.fn(),
  claimInboundEvent: vi.fn(), completePhotonEvent: vi.fn(), conversationDetails: vi.fn(), getMessagingSession: vi.fn(),
  listingForMessaging: vi.fn(), persistDibsMessage: vi.fn(), persistParticipantMessage: vi.fn(), recognizeIMessageUser: vi.fn(),
  saveMessagingSession: vi.fn(), uploadSellerPhotos: vi.fn(),
  updateIMessageUserProfile: vi.fn(),
  markAlphaOnboardingReplied: vi.fn(),
  markOnboardingCompleted: vi.fn(),
  cancelNotificationFollowups: vi.fn(),
}));
vi.mock("./marketplace", () => ({ ...mocks, normalizeIMessageIdentity: (value: string) => value.startsWith("+") ? value : null }));
vi.mock("./onboarding", () => ({ markAlphaOnboardingReplied: mocks.markAlphaOnboardingReplied, markOnboardingCompleted: mocks.markOnboardingCompleted }));
vi.mock("./notifications/store", () => ({ cancelNotificationFollowups: mocks.cancelNotificationFollowups }));
import { routePhotonMessage } from "./photon-router";

const inbound = (text: string, messageId = "parent-1"): InboundMessage => ({ messageId, conversationId: "space-1", senderId: "+13055550123", occurredAt: "2026-08-11T12:00:00.000Z", text, attachments: [] });
const session = (overrides: Partial<MessagingSession> = {}): MessagingSession => ({ identity: "+13055550123", user_id: "user-1", photon_space_id: "space-1", recent_listing_ids: [], recent_conversation_ids: [], recent_owned_listing_ids: [], context_kind: "search", selected_listing_id: null, active_conversation_id: null, seller_draft: null, seller_draft_version: 0, pending_listing_action: null, ...overrides });
const client = (plan: object, final: object = { text: "hey, what's up?", listings: [], closing: "" }): AiClient => { const replies = [JSON.stringify(plan), JSON.stringify(final)]; return { complete: vi.fn(async () => replies.shift()!) }; };
const noHistory = { loadHistory: vi.fn(async () => []), appendHistory: vi.fn(async () => undefined) };

describe("Photon AI routing boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.claimInboundEvent.mockResolvedValue(true); mocks.completePhotonEvent.mockResolvedValue(undefined);
    mocks.recognizeIMessageUser.mockResolvedValue({ user: { id: "user-1", city: "Miami, FL", name: null, imessage_address: "+13055550123" }, isNew: false });
    mocks.getMessagingSession.mockResolvedValue(session()); mocks.saveMessagingSession.mockResolvedValue(undefined); mocks.listingForMessaging.mockResolvedValue(null);
    mocks.markAlphaOnboardingReplied.mockResolvedValue(undefined);
    mocks.markOnboardingCompleted.mockResolvedValue(undefined);
    mocks.cancelNotificationFollowups.mockResolvedValue(0);
  });

  it("lets the AI greet without searching", async () => {
    const executeTool = vi.fn();
    const result = await routePhotonMessage(inbound("hey"), { ...noHistory, aiClient: client({ tools: [], responseHint: "greet naturally" }), executeTool });
    expect(executeTool).not.toHaveBeenCalled(); expect(result.response?.text).toBe("hey, what's up?");
    expect(mocks.markAlphaOnboardingReplied).toHaveBeenCalledWith("+13055550123", "space-1");
    expect(mocks.cancelNotificationFollowups).toHaveBeenCalledWith("user-1", "parent-1");
    expect(result.followupUserId).toBe("user-1");
    expect(mocks.markOnboardingCompleted).not.toHaveBeenCalled();
  });

  it.each(["cool", "ok", "thanks", "haha", "lol", "nice", "yeah", "no", "idk", "maybe", "nothing", "what's up"])("does not treat '%s' as semantic onboarding completion", async text => {
    await routePhotonMessage(inbound(text), {
      ...noHistory,
      aiClient: client({ tools: [], responseHint: "casual or ambiguous; respond naturally" }, { text: "what are you getting into?", listings: [], closing: "" }),
      executeTool: vi.fn(),
    });

    expect(mocks.markOnboardingCompleted).not.toHaveBeenCalled();
  });

  it("serves a first search immediately and marks meaningful onboarding complete", async () => {
    mocks.recognizeIMessageUser.mockResolvedValue({ user: { id: "user-1", city: null, name: null, imessage_address: "+13055550123" }, isNew: true });
    const executeTool = vi.fn(async () => ({ name: "searchListings" as const, ok: true, data: { listings: [] } }));
    await routePhotonMessage(inbound("looking for a ps5 under $300"), {
      ...noHistory,
      aiClient: client({ tools: [{ name: "searchListings", arguments: JSON.stringify({ query: "ps5", maxPriceCents: 30000, city: "Miami, FL" }) }], responseHint: "show results" }, { text: "nothing under $300 right now.", listings: [], closing: "" }),
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledWith({ name: "searchListings", arguments: { query: "ps5", maxPriceCents: 30000, city: "Miami, FL" } });
    expect(mocks.markOnboardingCompleted).toHaveBeenCalledWith("user-1", "buy");
  });

  it("starts seller behavior immediately without requiring missing profile fields", async () => {
    mocks.recognizeIMessageUser.mockResolvedValue({ user: { id: "user-1", city: null, name: null, imessage_address: "+13055550123" }, isNew: true });
    const executeTool = vi.fn(async () => ({ name: "updateSellerDraft" as const, ok: true, data: { draft: { title: "Couch", photos: [] }, missingFields: ["priceCents"] } }));
    await routePhotonMessage(inbound("i need to sell my couch"), {
      ...noHistory,
      aiClient: client({ tools: [{ name: "updateSellerDraft", arguments: JSON.stringify({ patch: { title: "Couch", category: "furniture" } }) }], responseHint: "ask the price" }, { text: "what price are you thinking?", listings: [], closing: "" }),
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledWith({ name: "updateSellerDraft", arguments: { patch: { title: "Couch", category: "furniture" } } });
    expect(mocks.markOnboardingCompleted).toHaveBeenCalledWith("user-1", "sell");
  });

  it("fails closed when AI is unavailable", async () => {
    const aiClient: AiClient = { complete: vi.fn(async () => { throw new Error("offline"); }) };
    const result = await routePhotonMessage(inbound("yeah"), { ...noHistory, aiClient, executeTool: vi.fn() });
    expect(result.response?.text).toContain("stuff is still saved");
    expect(result.followupUserId).toBeUndefined();
    expect(mocks.completePhotonEvent).toHaveBeenCalledWith("parent-1", "offline");
  });

  it("does nothing with a duplicate parent event", async () => {
    mocks.claimInboundEvent.mockResolvedValue(false);
    expect(await routePhotonMessage(inbound("yeah", "album"))).toEqual({ duplicate: true });
    expect(mocks.recognizeIMessageUser).not.toHaveBeenCalled();
  });

  it("keeps relay recipients canonical and ignores a typed phone number", async () => {
    mocks.getMessagingSession.mockResolvedValue(session({ context_kind: "chats", active_conversation_id: "conversation-1" }));
    mocks.conversationDetails.mockResolvedValue({ id: "conversation-1", buyer_id: "user-1", seller_id: "seller-1", listing: { title: "PS5" }, buyer: { id: "user-1", imessage_address: "+13055550123" }, seller: { id: "seller-1", imessage_address: "+13055550999" } });
    mocks.persistParticipantMessage.mockResolvedValue({ id: "participant" });
    const result = await routePhotonMessage(inbound("text +13055550777 instead"));
    expect(result.relay?.identity).toBe("+13055550999"); expect(result.relay?.identity).not.toBe("+13055550777");
    expect(result.followupUserId).toBeUndefined();
    expect(mocks.markOnboardingCompleted).toHaveBeenCalledWith("user-1", "existing_flow");
  });

  it("never makes an attachment-only response eligible for follow-ups", async () => {
    const message = { ...inbound(""), attachments: [{ id: "photo-1", read: async () => Buffer.from("photo") }] };
    mocks.uploadSellerPhotos.mockResolvedValue([]);
    const result = await routePhotonMessage(message, { ...noHistory, aiClient: client({ tools: [], responseHint: "acknowledge" }), executeTool: vi.fn() });
    expect(result.response).toBeDefined();
    expect(result.followupUserId).toBeUndefined();
  });

  it("replies only to a direct group address with the source listing and conversation pinned", async () => {
    const groupRoutingRepository: MarketplaceGroupRoutingRepository = {
      find: vi.fn(async () => ({
        id: "conversation-1", listing_id: "listing-1", buyer_id: "user-1", seller_id: "seller-1",
        provider_space_id: "space-1", provider_line: "+13055550000", buyer_provider_identity: "+13055550123",
        seller_provider_identity: "+13055550999", connection_status: "connected",
      })),
      persistMessage: vi.fn(async () => ({ id: "participant-1" })),
      previousOffer: vi.fn(async () => null),
      persistEvents: vi.fn(async () => undefined),
      confirmDeal: vi.fn(async () => undefined),
    };
    mocks.listingForMessaging.mockResolvedValue({
      id: "listing-1", seller_id: "seller-1", title: "Road Bike", description: "Fast bike", price_cents: 35000,
      condition: "good", city: "Miami", image_urls: [], status: "active", created_at: "now",
    });
    const result = await routePhotonMessage(
      { ...inbound("@Dibs, what was the asking price?"), providerLine: "+13055550000" },
      { ...noHistory, groupRoutingRepository, aiClient: client({ tools: [], responseHint: "answer using selected listing" }, { text: "the asking price is $350.", listings: [], closing: "" }), executeTool: vi.fn() },
    );
    expect(result.response?.text).toBe("the asking price is $350.");
    expect(result.followupUserId).toBeUndefined();
    expect(mocks.cancelNotificationFollowups).not.toHaveBeenCalled();
    expect(mocks.saveMessagingSession).toHaveBeenCalledWith("+13055550123", expect.objectContaining({
      selected_listing_id: "listing-1", active_conversation_id: "conversation-1", context_kind: "search",
    }));
    expect(noHistory.appendHistory).toHaveBeenCalledWith("user-1", expect.objectContaining({ body: "what was the asking price?" }), "parent-1");
  });
});