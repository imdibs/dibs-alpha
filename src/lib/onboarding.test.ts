import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), recordEvent: vi.fn(), saveSession: vi.fn(), updateResult: { data: { id: "onboarding-1" }, error: null } as { data: unknown; error: unknown },
}));
vi.mock("./db", () => ({ db: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("./analytics", () => ({ recordProductEvent: mocks.recordEvent }));
vi.mock("./marketplace", () => ({ saveMessagingSession: mocks.saveSession }));
import { ALPHA_FIRST_MESSAGE, processNextAlphaOnboarding } from "./onboarding";

const onboarding = {
  id: "onboarding-1", phone_e164: "+13055551234", user_id: "user-1", state: "sending", source: "website",
  visitor_id: "550e8400-e29b-41d4-a716-446655440000", attribution_token: "550e8400-e29b-41d4-a716-446655440001",
  originating_listing_id: "listing-1", photon_space_id: null, provider_message_id: null, submission_count: 1,
  attempt_count: 1, attempted_at: "now", sent_at: null, replied_at: null,
};

function updateChain() {
  return { update: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn(async () => mocks.updateResult) })) })) })) })) };
}

describe("Alpha onboarding Photon delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.updateResult = { data: { id: "onboarding-1" }, error: null };
    mocks.recordEvent.mockResolvedValue(undefined); mocks.saveSession.mockResolvedValue(undefined);
    mocks.from.mockImplementation(() => updateChain());
    mocks.rpc.mockResolvedValue({ data: [onboarding], error: null });
  });

  it("sends the one backend-owned template and confirms a provider message ID", async () => {
    const send = vi.fn(async () => ({ id: "provider-1" }));
    const transport = { createSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn(async () => undefined) };
    expect(await processNextAlphaOnboarding(transport)).toBe(true);
    expect(transport.createSpace).toHaveBeenCalledWith("+13055551234");
    expect(send).toHaveBeenCalledWith(ALPHA_FIRST_MESSAGE);
    expect(mocks.saveSession).toHaveBeenCalledWith("+13055551234", { user_id: "user-1", photon_space_id: "space-1" });
    expect(transport.recordSent).toHaveBeenCalledWith("provider-1", "space-1", "+13055551234");
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "alpha_first_message_attempted", userId: "user-1", listingId: "listing-1" }));
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "alpha_first_message_sent", userId: "user-1" }));
  });

  it("passes the queued canonical international identity unchanged to Photon and session storage", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...onboarding, phone_e164: "+447911123456" }], error: null });
    const send = vi.fn(async () => ({ id: "provider-international" }));
    const transport = { createSpace: vi.fn(async () => ({ id: "space-international", send })), recordSent: vi.fn(async () => undefined) };

    expect(await processNextAlphaOnboarding(transport)).toBe(true);
    expect(transport.createSpace).toHaveBeenCalledWith("+447911123456");
    expect(mocks.saveSession).toHaveBeenCalledWith("+447911123456", { user_id: "user-1", photon_space_id: "space-international" });
    expect(transport.recordSent).toHaveBeenCalledWith("provider-international", "space-international", "+447911123456");
  });

  it("marks a create-space outage as safely retryable without calling send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T18:00:00.000Z"));
    const transport = { createSpace: vi.fn(async () => { throw new Error("Photon secret"); }), recordSent: vi.fn() };
    try {
      expect(await processNextAlphaOnboarding(transport as never)).toBe(true);
      expect(transport.recordSent).not.toHaveBeenCalled();
      const update = mocks.from.mock.results.at(-1)?.value.update;
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        state: "failed",
        failure_class: "photon_unavailable",
        retryable: true,
        next_attempt_at: "2026-08-11T18:05:00.000Z",
        completed_at: "2026-08-11T18:00:00.000Z",
      }));
      const persisted = update.mock.calls[0][0] as { next_attempt_at: string };
      expect(new Date(persisted.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not make an ambiguous send failure automatically retryable", async () => {
    const send = vi.fn(async () => { throw new Error("timeout after dispatch"); });
    const transport = { createSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn() };
    expect(await processNextAlphaOnboarding(transport as never)).toBe(true);
    const update = mocks.from.mock.results.at(-1)?.value.update;
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      state: "sending",
      failure_class: "delivery_unknown",
      retryable: false,
      photon_space_id: "space-1",
      completed_at: null,
    }));
    const persisted = update.mock.calls[0][0] as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("next_attempt_at");
  });

  it("keeps provider-confirmed delivery sent when generic Photon telemetry fails", async () => {
    const send = vi.fn(async () => ({ id: "provider-1" }));
    const transport = { createSpace: vi.fn(async () => ({ id: "space-1", send })), recordSent: vi.fn(async () => { throw new Error("database unavailable"); }) };
    expect(await processNextAlphaOnboarding(transport)).toBe(true);
    const updates = mocks.from.mock.results.map(result => result.value.update).filter(Boolean);
    expect(updates.some(update => update.mock.calls.some((call: unknown[]) => (call[0] as { state?: string }).state === "sent"))).toBe(true);
    expect(updates.some(update => update.mock.calls.some((call: unknown[]) => (call[0] as { failure_class?: string }).failure_class === "delivery_unknown"))).toBe(false);
  });

  it("does nothing when the durable queue has no claimable request", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    const transport = { createSpace: vi.fn(), recordSent: vi.fn() };
    expect(await processNextAlphaOnboarding(transport as never)).toBe(false);
    expect(transport.createSpace).not.toHaveBeenCalled();
  });
});