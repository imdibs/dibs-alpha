import type { InboundMessage } from "../messaging";
import type { PhotonRouterResult } from "../photon-router";

export type SentPhotonText = { id: string; occurredAt: string };

export function followupScheduleRequest(
  inbound: InboundMessage,
  result: PhotonRouterResult,
  sentTextMessages: SentPhotonText[],
): { userId: string; inboundMessageId: string; outboundMessageId: string } | null {
  const lastTextMessage = sentTextMessages.at(-1);
  if (!result.followupUserId || !lastTextMessage) return null;
  return {
    userId: result.followupUserId,
    inboundMessageId: inbound.messageId,
    outboundMessageId: lastTextMessage.id,
  };
}