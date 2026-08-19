import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), recordEvent: vi.fn(), getSession: vi.fn(), saveSession: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("./analytics", () => ({ recordProductEvent: mocks.recordEvent }));
vi.mock("./marketplace", () => ({ getMessagingSession: mocks.getSession, saveMessagingSession: mocks.saveSession }));
import { ALPHA_FIRST_MESSAGE, processNextAlphaOnboarding, submitAlphaOnboarding } from "./onboarding";

const messageRequest = {
  id: "550e8400-e29b-41d4-a716-446655440010", alpha_onboarding_id: "alpha-1",
  phone_e164: "+13055551234", user_id: "user-1", state: "preparing", source: "website",
  visitor_id: "550e8400-e29b-41d4-a716-446655440000", attribution_token: "550e8400-e29b-41d4-a716-446655440001",
  originating_listing_id: "listing-1", photon_space_id: null, provider_message_id: null,
  attempt_count: 1, claim_token: "550e8400-e29b-41d4-a716-446655440099",
  created_user: false, created_alpha_onboarding: false, retryable: true, failure_class: null,
};

function rpcResult(name: string) {
  if (name === "claim_onboarding_message_request") return { data: [messageRequest], error: null };
  if (name === "begin_onboarding_message_dispatch") return { data: [{ ...messageRequest, state: "sending", photon_space_id: "space-1" }], error: null };
  if (name === "complete_onboarding_message_request" || name === "fail_onboarding_message_request") return { data: [messageRequest], error: null };
  if (name === "claim_onboarding_message_request_analytics") return { data: true, error: null };
  return { data: null, error: null };
}

describe("onboarding message request delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockImplementation(async (name: string) => rpcResult(name));
    mocks.recordEvent.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue(null);
    mocks.saveSession.mockResolvedValue(undefined);
  });

  it("sends the backend-owned template and completes only the claimed request", async () => {
    const send = vi.fn(async () => ({ id: "provider-1" }));
    const transport = { resolveSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn(async () => undefined) };
    expect(await processNextAlphaOnboarding(transport)).toBe(true);
    expect(transport.resolveSpace).toHaveBeenCalledWith("+13055551234", null);
    expect(send).toHaveBeenCalledWith(ALPHA_FIRST_MESSAGE);
    expect(mocks.saveSession).toHaveBeenCalledWith("+13055551234", { user_id: "user-1", photon_space_id: "space-1" });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_onboarding_message_request", expect.objectContaining({ requested_id: messageRequest.id, requested_provider_message_id: "provider-1" }));
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "onboarding_message_sent", userId: "user-1" }));
  });

  it("reuses the existing messaging session without resetting its context", async () => {
    mocks.getSession.mockResolvedValue({ user_id: "user-1", photon_space_id: "existing-space", context_kind: "seller", seller_draft: { title: "Bike" } });
    const send = vi.fn(async () => ({ id: "provider-2" }));
    const transport = { resolveSpace: vi.fn(async () => ({ id: "existing-space", send })), recordSent: vi.fn(async () => undefined) };
    await processNextAlphaOnboarding(transport as never);
    expect(transport.resolveSpace).toHaveBeenCalledWith("+13055551234", "existing-space");
    expect(mocks.saveSession).toHaveBeenCalledWith("+13055551234", { user_id: "user-1", photon_space_id: "existing-space" });
    expect(JSON.stringify(mocks.saveSession.mock.calls)).not.toContain("seller_draft");
  });

  it("keeps AI history attached to the same user by rejecting a conflicting session", async () => {
    mocks.getSession.mockResolvedValue({ user_id: "different-user", photon_space_id: "space-1" });
    const transport = { resolveSpace: vi.fn(), recordSent: vi.fn() };
    await processNextAlphaOnboarding(transport as never);
    expect(transport.resolveSpace).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("fail_onboarding_message_request", expect.objectContaining({ requested_failure_class: "photon_unavailable", requested_retryable: true }));
  });

  it("marks Photon preparation failures retryable before send", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-11T18:00:00.000Z"));
    const transport = { resolveSpace: vi.fn(async () => { throw new Error("Photon unavailable"); }), recordSent: vi.fn() };
    try {
      await processNextAlphaOnboarding(transport as never);
      expect(mocks.rpc).toHaveBeenCalledWith("fail_onboarding_message_request", expect.objectContaining({
        requested_id: messageRequest.id, requested_failure_class: "photon_unavailable", requested_retryable: true,
        requested_next_attempt_at: "2026-08-11T18:05:00.000Z",
      }));
    } finally { vi.useRealTimers(); }
  });

  it("never retries an ambiguous failure after dispatch begins", async () => {
    const send = vi.fn(async () => { throw new Error("timeout after dispatch"); });
    const transport = { resolveSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn() };
    await processNextAlphaOnboarding(transport as never);
    expect(mocks.rpc).toHaveBeenCalledWith("fail_onboarding_message_request", expect.objectContaining({
      requested_id: messageRequest.id, requested_failure_class: "delivery_unknown", requested_retryable: false, requested_next_attempt_at: null,
    }));
  });

  it("does not send if begin-dispatch persistence fails", async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === "begin_onboarding_message_dispatch"
      ? { data: null, error: { message: "unavailable" } } : rpcResult(name));
    const send = vi.fn();
    await processNextAlphaOnboarding({ resolveSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn() });
    expect(send).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("fail_onboarding_message_request", expect.objectContaining({ requested_failure_class: "persistence_error", requested_retryable: true }));
  });

  it("reconciles a lost begin-dispatch response before sending", async () => {
    let beginCalls = 0;
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "begin_onboarding_message_dispatch" && beginCalls++ === 0) return { data: null, error: { message: "response lost" } };
      return rpcResult(name);
    });
    const send = vi.fn(async () => ({ id: "provider-reconciled" }));
    await processNextAlphaOnboarding({ resolveSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn(async () => undefined) });
    expect(beginCalls).toBe(2);
    expect(send).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalledWith("fail_onboarding_message_request", expect.anything());
  });

  it("emits request analytics once and signup analytics only for a first onboarding", async () => {
    const first = { ...messageRequest, state: "pending", created_user: true, created_alpha_onboarding: true };
    mocks.rpc.mockImplementation(async (name: string) => name === "enqueue_onboarding_message_request" ? { data: [first], error: null } : rpcResult(name));
    await submitAlphaOnboarding({ requestId: first.id, phone: first.phone_e164, source: "website", recipientKeyHash: "a".repeat(64), visitorId: null, attributionId: null, originatingListingId: null });
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "onboarding_message_requested" }));
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "alpha_onboarding_accepted" }));

    mocks.recordEvent.mockClear();
    mocks.rpc.mockImplementation(async (name: string) => name === "enqueue_onboarding_message_request" ? { data: [{ ...first, id: "550e8400-e29b-41d4-a716-446655440011", created_user: false, created_alpha_onboarding: false }], error: null } : rpcResult(name));
    await submitAlphaOnboarding({ requestId: "550e8400-e29b-41d4-a716-446655440011", phone: first.phone_e164, source: "website", recipientKeyHash: "a".repeat(64), visitorId: null, attributionId: null, originatingListingId: null });
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "onboarding_message_requested" }));
    expect(mocks.recordEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventName: "alpha_onboarding_accepted" }));
  });

  it("does nothing when no durable request is claimable", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    const transport = { resolveSpace: vi.fn(), recordSent: vi.fn() };
    expect(await processNextAlphaOnboarding(transport as never)).toBe(false);
    expect(transport.resolveSpace).not.toHaveBeenCalled();
  });
});