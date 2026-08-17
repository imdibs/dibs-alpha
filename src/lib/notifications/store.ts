import { db } from "../db";
import type { ClaimedNotificationOpportunity, NotificationFailureClass, NotificationOpportunity } from "./types";

function rpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] || null : data;
}

export async function scheduleUnansweredFollowup(userId: string, inboundMessageId: string, outboundMessageId: string): Promise<NotificationOpportunity> {
  const result = await db().rpc("schedule_unanswered_followup", {
    requested_user_id: userId,
    requested_source_inbound_message_id: inboundMessageId,
    requested_source_outbound_message_id: outboundMessageId,
  });
  const row = rpcRow(result.data as NotificationOpportunity | NotificationOpportunity[] | null);
  if (result.error || !row) throw new Error("Could not schedule unanswered follow-up.");
  return row;
}

export async function cancelNotificationFollowups(userId: string, inboundMessageId: string): Promise<number> {
  const result = await db().rpc("cancel_notification_followups", { requested_user_id: userId, requested_inbound_message_id: inboundMessageId });
  if (result.error) throw new Error("Could not cancel notification follow-ups.");
  return Number(result.data || 0);
}

export async function claimNotificationOpportunity(): Promise<ClaimedNotificationOpportunity | null> {
  const result = await db().rpc("claim_notification_opportunity");
  if (result.error) throw new Error("Could not claim notification opportunity.");
  const row = rpcRow(result.data as NotificationOpportunity | NotificationOpportunity[] | null);
  if (!row) return null;
  if (!row.claim_token) throw new Error("Claimed notification opportunity has no claim token.");
  return row as ClaimedNotificationOpportunity;
}

export async function beginNotificationDelivery(opportunity: ClaimedNotificationOpportunity, message: string, reason: string): Promise<NotificationOpportunity | null> {
  const result = await db().rpc("begin_notification_delivery", {
    requested_id: opportunity.id, requested_claim_token: opportunity.claim_token,
    requested_message_text: message, requested_reason: reason,
  });
  if (result.error) throw new Error("Could not authorize notification delivery.");
  return rpcRow(result.data as NotificationOpportunity | NotificationOpportunity[] | null);
}

export async function suppressNotificationOpportunity(opportunity: ClaimedNotificationOpportunity, reason: string): Promise<boolean> {
  const result = await db().rpc("suppress_notification_opportunity", { requested_id: opportunity.id, requested_claim_token: opportunity.claim_token, requested_reason: reason });
  if (result.error) throw new Error("Could not suppress notification opportunity.");
  return Boolean(result.data);
}

export async function failNotificationOpportunity(opportunity: ClaimedNotificationOpportunity, failureClass: NotificationFailureClass, retryable: boolean): Promise<boolean> {
  const delayMinutes = Math.min(30, 2 ** Math.max(0, opportunity.attempt_count - 1));
  const result = await db().rpc("fail_notification_opportunity", {
    requested_id: opportunity.id,
    requested_claim_token: opportunity.claim_token,
    requested_failure_class: failureClass,
    requested_retryable: retryable,
    requested_next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
  });
  if (result.error) throw new Error("Could not record notification failure.");
  return Boolean(result.data);
}

export async function completeNotificationDelivery(opportunity: ClaimedNotificationOpportunity, providerMessageId: string, deliveredAt: string): Promise<NotificationOpportunity | null> {
  const result = await db().rpc("complete_notification_delivery", {
    requested_id: opportunity.id, requested_claim_token: opportunity.claim_token,
    requested_provider_message_id: providerMessageId,
    requested_delivered_at: deliveredAt,
  });
  if (result.error) throw new Error("Could not confirm notification delivery.");
  return rpcRow(result.data as NotificationOpportunity | NotificationOpportunity[] | null);
}