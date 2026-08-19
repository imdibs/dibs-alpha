import { describe, expect, it, vi } from "vitest";
import { buildPhotonReply, parsePhotonInbound, photonAttachmentMetadata, sendPhotonReply } from "./photon";
import { displayListingTitle, formatSearchResults, renderRelay, routeInboundMessage } from "./messaging";
import { normalizeIMessageIdentity } from "./marketplace";

const space = { id: "chat-123", phone: "+13055550000", send: vi.fn(async () => undefined) };

describe("Photon messaging adapter", () => {
  it("parses inbound text and identifies its sender and conversation", () => {
    expect(parsePhotonInbound(space, {
      id: "message-1", direction: "inbound", sender: { id: "+13055550123" },
      timestamp: new Date("2026-08-11T12:00:00.000Z"),
      content: { type: "text", text: " Find me a PS5 under $300 near me. " },
    })).toEqual({
      messageId: "message-1", conversationId: "chat-123", senderId: "+13055550123",
      occurredAt: "2026-08-11T12:00:00.000Z",
      text: " Find me a PS5 under $300 near me. ", attachments: [], providerLine: "+13055550000",
    });
  });

  it("ignores outbound and empty events while retaining readable attachment metadata", () => {
    const read = vi.fn(async () => Buffer.from("image"));
    expect(parsePhotonInbound(space, { direction: "outbound", content: { type: "text", text: "Hi" } })).toBeUndefined();
    expect(parsePhotonInbound(space, { id: "missing-direction", content: { type: "text", text: "Hi" } })).toBeUndefined();
    expect(parsePhotonInbound(space, { direction: "inbound", content: { type: "text", text: "Hi" } })).toBeUndefined();
    expect(photonAttachmentMetadata({ content: { type: "attachment", id: "file-1", name: "photo.jpg", mimeType: "image/jpeg", size: 20, read } })).toEqual({ id: "file-1", name: "photo.jpg", mimeType: "image/jpeg", size: 20, read });
  });

  it("parses one attachment as one inbound parent message", () => {
    const read = vi.fn(async () => Buffer.from("image"));
    const inbound = parsePhotonInbound(space, {
      id: "parent-1", direction: "inbound", sender: { id: "+13055550123" },
      content: { type: "attachment", id: "file-1", name: "one.jpg", mimeType: "image/jpeg", size: 5, read },
    });
    expect(inbound).toMatchObject({ messageId: "parent-1", text: "", attachments: [{ id: "file-1", name: "one.jpg" }] });
    expect(read).not.toHaveBeenCalled();
  });

  it("parses grouped text and ordered attachments under the parent message ID", () => {
    const firstRead = vi.fn(async () => Buffer.from("first"));
    const secondRead = vi.fn(async () => Buffer.from("second"));
    const inbound = parsePhotonInbound(space, {
      id: "parent-album", direction: "inbound", sender: { id: "+13055550123" },
      content: { type: "group", items: [
        { id: "child-1", content: { type: "attachment", id: "photo-1", name: "1.jpg", mimeType: "image/jpeg", read: firstRead } },
        { id: "child-text", content: { type: "text", text: "my PS5" } },
        { id: "child-2", content: { type: "attachment", id: "photo-2", name: "2.png", mimeType: "image/png", read: secondRead } },
      ] },
    });
    expect(inbound?.messageId).toBe("parent-album");
    expect(inbound?.text).toBe("my PS5");
    expect(inbound?.attachments.map(item => item.id)).toEqual(["photo-1", "photo-2"]);
    expect(firstRead).not.toHaveBeenCalled();
    expect(secondRead).not.toHaveBeenCalled();
  });

  it("normalizes only safe unique iMessage identity forms", () => {
    expect(normalizeIMessageIdentity(" +1 (305) 555-0123 ")).toBe("+13055550123");
    expect(normalizeIMessageIdentity("Buyer@Example.COM")).toBe("buyer@example.com");
    expect(normalizeIMessageIdentity("3055550123")).toBeNull();
  });

  it("removes test labels and quotes exact participant messages in relays", () => {
    expect(displayListingTitle("[ALPHA TEST] PS5 Slim")).toBe("PS5 Slim");
    expect(renderRelay("buyer", "is this still available?", "[ALPHA TEST] PS5 Slim")).toBe("yo, someone is asking about PS5 Slim: “is this still available?”");
    expect(renderRelay("seller", "yeah", "PS5 Slim")).toBe("the seller replied about PS5 Slim: “yeah”");
  });

  it("routes message text through Dibs search with the Alpha city", async () => {
    const search = vi.fn(async () => ({ intent: { query: "PS5", maxPriceCents: 30000, city: "Miami, FL" }, listings: [] }));
    await routeInboundMessage({ messageId: "1", conversationId: "c", senderId: "+1", occurredAt: "2026-08-11T12:00:00.000Z", text: "PS5 under $300 near me", attachments: [] }, { search });
    expect(search).toHaveBeenCalledWith("PS5 under $300 near me", "Miami, FL");
  });

  it("formats concise real listing fields", () => {
    const text = formatSearchResults({
      intent: { query: "PS5", maxPriceCents: 30000, city: "Miami, FL" },
      listings: [{ id: "1", seller_id: "s", title: "PS5 Slim", description: "Works", price_cents: 28000, condition: "good", city: "Miami, FL", image_urls: ["image"], status: "active", created_at: "now" }],
    });
    expect(text).toContain("Found 1 PS5 under $300 near Miami, FL:");
    expect(text).toContain("1. PS5 Slim — $280\n   Miami, FL");
  });

  it("constructs and sends an outbound reply to the same Photon space", async () => {
    expect(buildPhotonReply("chat-123", " Results ")).toEqual({ conversationId: "chat-123", text: "Results" });
    space.send.mockClear();
    await sendPhotonReply(space, "Results");
    expect(space.send).toHaveBeenCalledWith("Results");
  });
});