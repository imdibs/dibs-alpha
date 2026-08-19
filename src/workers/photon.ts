import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { OutboundMessage } from "../lib/messaging";
import { recordOutboundEvent } from "../lib/marketplace";
import { parsePhotonInbound, sendPhotonReply } from "../lib/photon";
import { sendOrderedPhotonOutput, type PhotonOutputSpace } from "../lib/photon-output";
import { routePhotonMessage } from "../lib/photon-router";
import { processNextAlphaOnboarding } from "../lib/onboarding";
import { processNextNotificationOpportunity } from "../lib/notifications/processor";
import { scheduleUnansweredFollowup } from "../lib/notifications/store";
import { withNotificationDeliveryGate } from "../lib/notifications/delivery-gate";
import { followupScheduleRequest } from "../lib/notifications/scheduling";

function required(name: "PHOTON_PROJECT_ID" | "PHOTON_PROJECT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const app = await Spectrum({
    projectId: required("PHOTON_PROJECT_ID"),
    projectSecret: required("PHOTON_PROJECT_SECRET"),
    providers: [imessage.config()],
    options: { logLevel: "info" },
  });

  console.log("Dibs Photon worker connected and waiting for iMessages.");
  const iMessage = imessage(app);
  let onboardingBusy = false;
  let notificationBusy = false;

  async function recordSent(sent: { id?: string; timestamp?: Date } | undefined, spaceId: string, identity: string, kind: "dibs_reply" | "dibs_relay" | "dibs_attachment") {
    if (sent?.id) await recordOutboundEvent({ messageId: sent.id, spaceId, identity, kind, occurredAt: (sent.timestamp || new Date()).toISOString() });
  }

  async function sendOutput(
    space: PhotonOutputSpace,
    identity: string,
    output: OutboundMessage,
    kind: "dibs_reply" | "dibs_relay",
  ) {
    return sendOrderedPhotonOutput(space, identity, output, kind, recordSent);
  }

  async function processOnboarding() {
    if (onboardingBusy) return;
    onboardingBusy = true;
    try {
      await processNextAlphaOnboarding({
        resolveSpace: (identity, existingSpaceId) => existingSpaceId
          ? iMessage.space.get(existingSpaceId)
          : process.env.PHOTON_IMESSAGE_LINE
            ? iMessage.space.create(identity, { phone: process.env.PHOTON_IMESSAGE_LINE })
            : iMessage.space.create(identity),
        recordSent: async (messageId, spaceId, identity) => recordOutboundEvent({ messageId, spaceId, identity, kind: "dibs_reply", occurredAt: new Date().toISOString() }),
      });
    } catch (error) {
      console.error("Could not process Alpha onboarding", error instanceof Error ? error.message : "Unknown error");
    } finally {
      onboardingBusy = false;
    }
  }

  const onboardingTimer = setInterval(() => void processOnboarding(), 5_000);
  onboardingTimer.unref();
  void processOnboarding();

  async function processNotifications() {
    if (notificationBusy) return;
    notificationBusy = true;
    try {
      await processNextNotificationOpportunity({ createSpace: spaceId => iMessage.space.get(spaceId) });
    } catch (error) {
      console.error("Could not process notification opportunity", error instanceof Error ? error.message : "Unknown error");
    } finally {
      notificationBusy = false;
    }
  }

  const notificationTimer = setInterval(() => void processNotifications(), 5_000);
  notificationTimer.unref();
  void processNotifications();

  async function stop(signal: string) {
    console.log(`Stopping Dibs Photon worker (${signal}).`);
    clearInterval(onboardingTimer);
    clearInterval(notificationTimer);
    await app.stop();
    process.exit(0);
  }
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  for await (const [space, message] of app.messages) {
    const inbound = parsePhotonInbound(space, message);
    if (!inbound) continue;
    console.log("Received Photon message", {
      messageId: inbound.messageId,
      conversationId: inbound.conversationId,
    });
    try {
      await withNotificationDeliveryGate(inbound.conversationId, () => space.responding(async () => {
        const result = await routePhotonMessage(inbound, {
          defaultCity: process.env.PHOTON_DEFAULT_CITY || "Miami, FL",
        });
        if (result.duplicate) {
          console.log("Ignored duplicate Photon message", { messageId: inbound.messageId });
          return;
        }
        if (result.response) {
          const sent = await sendOutput(space, inbound.senderId, result.response, "dibs_reply");
          const followup = followupScheduleRequest(inbound, result, sent.textMessages);
          if (followup) {
            await scheduleUnansweredFollowup(followup.userId, followup.inboundMessageId, followup.outboundMessageId)
              .catch(error => console.warn("Could not schedule unanswered follow-up", error));
          }
        }
        if (result.relay) {
          const relaySpace = process.env.PHOTON_IMESSAGE_LINE
            ? await iMessage.space.create(result.relay.identity, { phone: process.env.PHOTON_IMESSAGE_LINE })
            : await iMessage.space.create(result.relay.identity);
          await sendOutput(relaySpace, result.relay.identity, result.relay.message, "dibs_relay");
        }
      }));
    } catch (error) {
      console.error("Could not process Photon message", error instanceof Error ? error.message : "Unknown error");
      await sendPhotonReply(space, "Sorry, I couldn't process that message right now. Please try again shortly.");
    }
  }
}

main().catch((error) => {
  console.error("Dibs Photon worker failed to start:", error instanceof Error ? error.message : "Unknown error");
  process.exit(1);
});