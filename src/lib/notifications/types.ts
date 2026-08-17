import type { AiHistoryTurn } from "../ai/types";

export type NotificationKind = "unanswered_10m" | "final_24h";
export type NotificationState = "scheduled" | "evaluating" | "sending" | "sent" | "suppressed" | "cancelled" | "failed" | "delivery_unknown";
export type NotificationFailureClass = "ai_unavailable" | "photon_unavailable" | "persistence_error" | "delivery_unknown";

export type NotificationOpportunity = {
  id: string;
  user_id: string;
  kind: NotificationKind;
  stage: 1 | 2;
  parent_opportunity_id: string | null;
  source_inbound_message_id: string;
  source_outbound_message_id: string;
  source_sent_at: string;
  photon_space_id: string;
  due_at: string;
  state: NotificationState;
  attempt_count: number;
  claim_token: string | null;
};

export type ClaimedNotificationOpportunity = NotificationOpportunity & { claim_token: string };

export type FollowupContext = {
  kind: NotificationKind;
  history: AiHistoryTurn[];
};

export type FollowupDecision =
  | { action: "notify"; reason: string; message: string }
  | { action: "ignore"; reason: string };