import { describe, expect, it } from "vitest";
import type { InboundMessage } from "../messaging";
import { followupScheduleRequest } from "./scheduling";

const inbound = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  messageId: "inbound-1", conversationId: "space-1", senderId: "+13055550123",
  occurredAt: "2026-08-11T12:00:00.000Z", text: "find a PS5", attachments: [], ...overrides,
});

describe("Dibs response follow-up scheduling boundary", () => {
  it("schedules a normal Dibs response exactly once from its final text message", () => {
    expect(followupScheduleRequest(inbound(), { response: { text: "found one" }, followupUserId: "user-1" }, [
      { id: "outbound-1", occurredAt: "2026-08-11T12:00:01.000Z" },
      { id: "outbound-2", occurredAt: "2026-08-11T12:00:02.000Z" },
    ])).toEqual({ userId: "user-1", inboundMessageId: "inbound-1", outboundMessageId: "outbound-2" });
  });

  it("does not schedule onboarding, relay, or attachment-only responses", () => {
    const sent = [{ id: "outbound-1", occurredAt: "2026-08-11T12:00:01.000Z" }];
    expect(followupScheduleRequest(inbound(), {}, sent)).toBeNull();
    expect(followupScheduleRequest(inbound(), { relay: { identity: "+13055550999", message: { text: "relay" }, conversationId: "conversation-1", sourceMessageId: "message-1" } }, sent)).toBeNull();
    expect(followupScheduleRequest(inbound({ text: "", attachments: [{ id: "photo-1", read: async () => Buffer.from("photo") }] }), { response: { text: "got it" } }, sent)).toBeNull();
  });
});