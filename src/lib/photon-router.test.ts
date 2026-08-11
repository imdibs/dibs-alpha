import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundMessage } from "./messaging";
import type { MessagingSession } from "./marketplace";
import type { AiClient } from "./ai/types";

const mocks = vi.hoisted(() => ({
  activeListingsForSeller: vi.fn(), createListingFromDraft: vi.fn(), deleteSellerDraftPhotos: vi.fn(), updateOwnedListing: vi.fn(),
  claimInboundEvent: vi.fn(), completePhotonEvent: vi.fn(), conversationDetails: vi.fn(), getMessagingSession: vi.fn(),
  listingForMessaging: vi.fn(), persistDibsMessage: vi.fn(), persistParticipantMessage: vi.fn(), recognizeIMessageUser: vi.fn(),
  saveMessagingSession: vi.fn(), uploadSellerPhotos: vi.fn(),
}));
vi.mock("./marketplace", () => ({ ...mocks, normalizeIMessageIdentity: (value: string) => value.startsWith("+") ? value : null }));
import { routePhotonMessage } from "./photon-router";

const inbound = (text: string, messageId = "parent-1"): InboundMessage => ({ messageId, conversationId: "space-1", senderId: "+13055550123", text, attachments: [] });
const session = (overrides: Partial<MessagingSession> = {}): MessagingSession => ({ identity: "+13055550123", user_id: "user-1", photon_space_id: "space-1", recent_listing_ids: [], recent_conversation_ids: [], recent_owned_listing_ids: [], context_kind: "search", selected_listing_id: null, active_conversation_id: null, seller_draft: null, seller_draft_version: 0, pending_listing_action: null, ...overrides });
const client = (plan: object, final: object = { text: "hey, what's up?", listings: [], closing: "" }): AiClient => { const replies = [JSON.stringify(plan), JSON.stringify(final)]; return { complete: vi.fn(async () => replies.shift()!) }; };
const noHistory = { loadHistory: vi.fn(async () => []), appendHistory: vi.fn(async () => undefined) };

describe("Photon AI routing boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.claimInboundEvent.mockResolvedValue(true); mocks.completePhotonEvent.mockResolvedValue(undefined);
    mocks.recognizeIMessageUser.mockResolvedValue({ user: { id: "user-1", city: "Miami, FL", name: null, imessage_address: "+13055550123" }, isNew: false });
    mocks.getMessagingSession.mockResolvedValue(session()); mocks.saveMessagingSession.mockResolvedValue(undefined); mocks.listingForMessaging.mockResolvedValue(null);
  });

  it("lets the AI greet without searching", async () => {
    const executeTool = vi.fn();
    const result = await routePhotonMessage(inbound("hey"), { ...noHistory, aiClient: client({ tools: [], responseHint: "greet naturally" }), executeTool });
    expect(executeTool).not.toHaveBeenCalled(); expect(result.response?.text).toBe("hey, what's up?");
  });

  it("fails closed when AI is unavailable", async () => {
    const aiClient: AiClient = { complete: vi.fn(async () => { throw new Error("offline"); }) };
    const result = await routePhotonMessage(inbound("yeah"), { ...noHistory, aiClient, executeTool: vi.fn() });
    expect(result.response?.text).toContain("stuff is still saved");
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
  });
});