import { loadAiHistory } from "../ai/memory";
import type { AiHistoryTurn } from "../ai/types";
import { decideFollowup } from "./decision";
import { withNotificationDeliveryGate } from "./delivery-gate";
import {
  beginNotificationDelivery, claimNotificationOpportunity, completeNotificationDelivery,
  failNotificationOpportunity, suppressNotificationOpportunity,
} from "./store";
import type { ClaimedNotificationOpportunity, FollowupDecision, NotificationOpportunity } from "./types";

export type NotificationTransport = {
  createSpace(spaceId: string): Promise<{ send(text: string): Promise<{ id?: string; timestamp?: Date } | undefined> }>;
};

export type NotificationProcessorDependencies = {
  claim?: typeof claimNotificationOpportunity;
  loadHistory?: (userId: string) => Promise<AiHistoryTurn[]>;
  decide?: (context: { kind: NotificationOpportunity["kind"]; history: AiHistoryTurn[] }) => Promise<FollowupDecision>;
  beginDelivery?: typeof beginNotificationDelivery;
  suppress?: typeof suppressNotificationOpportunity;
  fail?: typeof failNotificationOpportunity;
  completeDelivery?: typeof completeNotificationDelivery;
};

export async function processNextNotificationOpportunity(transport: NotificationTransport, dependencies: NotificationProcessorDependencies = {}): Promise<boolean> {
  const claim = dependencies.claim || claimNotificationOpportunity;
  const opportunity = await claim();
  if (!opportunity) return false;
  const fail = dependencies.fail || failNotificationOpportunity;
  let decision: FollowupDecision;
  try {
    const history = await (dependencies.loadHistory || loadAiHistory)(opportunity.user_id);
    decision = await (dependencies.decide || decideFollowup)({ kind: opportunity.kind, history });
  } catch {
    await fail(opportunity, "ai_unavailable", opportunity.attempt_count < 3);
    return true;
  }

  if (decision.action === "ignore") {
    await (dependencies.suppress || suppressNotificationOpportunity)(opportunity, decision.reason);
    return true;
  }

  let space: Awaited<ReturnType<NotificationTransport["createSpace"]>>;
  try {
    space = await transport.createSpace(opportunity.photon_space_id);
  } catch {
    await fail(opportunity, "photon_unavailable", opportunity.attempt_count < 3);
    return true;
  }

  await withNotificationDeliveryGate(opportunity.photon_space_id, async () => {
    let authorized: NotificationOpportunity | null;
    try {
      authorized = await (dependencies.beginDelivery || beginNotificationDelivery)(opportunity, decision.message, decision.reason);
    } catch {
      await fail(opportunity, "persistence_error", opportunity.attempt_count < 3);
      return;
    }
    if (!authorized || authorized.state !== "sending") return;
    const sending = authorized as ClaimedNotificationOpportunity;
    try {
      const sent = await space.send(decision.message);
      if (!sent?.id) throw new Error("Photon did not confirm delivery.");
      const deliveredAt = (sent.timestamp || new Date()).toISOString();
      const completed = await (dependencies.completeDelivery || completeNotificationDelivery)(sending, sent.id, deliveredAt);
      if (!completed) throw new Error("Notification delivery confirmation was not persisted.");
    } catch {
      await fail(sending, "delivery_unknown", false);
    }
  });
  return true;
}