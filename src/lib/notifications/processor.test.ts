import { beforeEach, describe, expect, it, vi } from "vitest";
import { processNextNotificationOpportunity, type NotificationProcessorDependencies } from "./processor";
import type { ClaimedNotificationOpportunity, FollowupDecision, NotificationOpportunity } from "./types";

const opportunity = (overrides: Partial<Omit<NotificationOpportunity, "claim_token">> & { claim_token?: string } = {}): ClaimedNotificationOpportunity => ({
  id: "opportunity-1", user_id: "user-1", kind: "unanswered_10m", stage: 1,
  parent_opportunity_id: null, source_inbound_message_id: "inbound-1", source_outbound_message_id: "outbound-1",
  source_sent_at: "2026-08-11T12:00:00.000Z", photon_space_id: "space-1", due_at: "2026-08-11T12:10:00.000Z",
  state: "evaluating", attempt_count: 1, ...overrides, claim_token: overrides.claim_token || "claim-1",
});

function fixture(row: ClaimedNotificationOpportunity | null = opportunity()) {
  const sent: { id?: string; timestamp?: Date } = { id: "followup-provider-1", timestamp: new Date("2026-08-11T12:10:01.000Z") };
  const space = { send: vi.fn(async () => sent) };
  const transport = { createSpace: vi.fn(async () => space) };
  const dependencies = {
    claim: vi.fn(async () => row), loadHistory: vi.fn(async () => [{ role: "user" as const, body: "PS5 under $300" }]),
    decide: vi.fn<() => Promise<FollowupDecision>>(async () => ({ action: "notify", reason: "useful", message: "still looking for that PS5?" })),
    beginDelivery: vi.fn(async item => ({ ...item, state: "sending" as const })), suppress: vi.fn(async () => true),
    fail: vi.fn(async () => true), completeDelivery: vi.fn(async item => ({ ...item, state: "sent" as const })),
  } satisfies Required<NotificationProcessorDependencies>;
  return { transport, space, dependencies };
}

describe("durable notification processor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when no durable opportunity is due", async () => {
    const { transport, dependencies } = fixture(null);
    await expect(processNextNotificationOpportunity(transport, dependencies)).resolves.toBe(false);
    expect(transport.createSpace).not.toHaveBeenCalled();
  });

  it("suppresses permanently when AI finds no useful message", async () => {
    const { transport, dependencies } = fixture();
    dependencies.decide.mockResolvedValue({ action: "ignore", reason: "silence is best" });
    await processNextNotificationOpportunity(transport, dependencies);
    expect(dependencies.suppress).toHaveBeenCalledWith(expect.objectContaining({ id: "opportunity-1" }), "silence is best");
    expect(transport.createSpace).not.toHaveBeenCalled();
  });

  it("revalidates once and sends at most one confirmed message", async () => {
    const { transport, space, dependencies } = fixture();
    await processNextNotificationOpportunity(transport, dependencies);
    expect(transport.createSpace).toHaveBeenCalledWith("space-1");
    expect(dependencies.beginDelivery).toHaveBeenCalledTimes(1);
    expect(space.send).toHaveBeenCalledTimes(1);
    expect(space.send).toHaveBeenCalledWith("still looking for that PS5?");
    expect(dependencies.completeDelivery).toHaveBeenCalledWith(expect.objectContaining({ state: "sending" }), "followup-provider-1", "2026-08-11T12:10:01.000Z");
  });

  it("does not send when pre-send revalidation cancels the opportunity", async () => {
    const { transport, space, dependencies } = fixture();
    dependencies.beginDelivery.mockResolvedValue({ ...opportunity(), state: "cancelled" });
    await processNextNotificationOpportunity(transport, dependencies);
    expect(space.send).not.toHaveBeenCalled();
  });

  it("retries AI and space lookup only before sending, up to three claims", async () => {
    const first = fixture(opportunity({ attempt_count: 1 }));
    first.dependencies.decide.mockRejectedValue(new Error("offline"));
    await processNextNotificationOpportunity(first.transport, first.dependencies);
    expect(first.dependencies.fail).toHaveBeenCalledWith(expect.anything(), "ai_unavailable", true);

    const third = fixture(opportunity({ attempt_count: 3 }));
    third.transport.createSpace.mockRejectedValue(new Error("unavailable"));
    await processNextNotificationOpportunity(third.transport, third.dependencies);
    expect(third.dependencies.fail).toHaveBeenCalledWith(expect.anything(), "photon_unavailable", false);
  });

  it("never retries an ambiguous Photon send", async () => {
    const { transport, space, dependencies } = fixture();
    space.send.mockRejectedValue(new Error("unknown outcome"));
    await processNextNotificationOpportunity(transport, dependencies);
    expect(dependencies.fail).toHaveBeenCalledWith(expect.objectContaining({ state: "sending" }), "delivery_unknown", false);
    expect(space.send).toHaveBeenCalledTimes(1);
  });

  it("never retries when Photon omits a provider confirmation", async () => {
    const { transport, space, dependencies } = fixture();
    space.send.mockResolvedValue({ id: undefined });
    await processNextNotificationOpportunity(transport, dependencies);
    expect(dependencies.fail).toHaveBeenCalledWith(expect.anything(), "delivery_unknown", false);
  });

  it("treats a lost completion persistence result as terminal delivery ambiguity", async () => {
    const { transport, dependencies } = fixture();
    dependencies.completeDelivery.mockResolvedValue(null);
    await processNextNotificationOpportunity(transport, dependencies);
    expect(dependencies.fail).toHaveBeenCalledWith(expect.objectContaining({ state: "sending" }), "delivery_unknown", false);
  });

  it("the final stage follows the same one-send path without processor-created children", async () => {
    const final = opportunity({ id: "final-1", kind: "final_24h", stage: 2, parent_opportunity_id: "opportunity-1" });
    const { transport, space, dependencies } = fixture(final);
    await processNextNotificationOpportunity(transport, dependencies);
    expect(space.send).toHaveBeenCalledTimes(1);
    expect(dependencies.completeDelivery).toHaveBeenCalledTimes(1);
  });
});