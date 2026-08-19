import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { OutboundMessage } from "../lib/messaging";
import { recordOutboundEvent } from "../lib/marketplace";
import { parsePhotonInbound, sendPhotonReply, type PhotonMessageLike } from "../lib/photon";
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

type LogLevel = "info" | "warn" | "error";
type WorkerPhotonSpace = PhotonOutputSpace & {
  responding<T>(operation: () => Promise<T>): Promise<T>;
};

function log(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ level, event, service: "dibs-photon-worker", ...details });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function main() {
  log("info", "worker_started");
  let app: Awaited<ReturnType<typeof Spectrum>>;
  try {
    app = await Spectrum({
      projectId: required("PHOTON_PROJECT_ID"),
      projectSecret: required("PHOTON_PROJECT_SECRET"),
      providers: [imessage.config()],
      options: { logLevel: "info" },
    });
  } catch (error) {
    log("error", "photon_connection_failed", { error_type: errorType(error) });
    throw error;
  }

  log("info", "photon_connected");
  const iMessage = imessage(app);
  let onboardingBusy = false;
  let notificationBusy = false;
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();

  function track<T>(operation: Promise<T>): Promise<T> {
    inFlight.add(operation);
    void operation.then(
      () => inFlight.delete(operation),
      () => inFlight.delete(operation),
    );
    return operation;
  }

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
    if (stopping || onboardingBusy) return;
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
      log("error", "onboarding_processing_failed", { error_type: errorType(error) });
    } finally {
      onboardingBusy = false;
    }
  }

  const onboardingTimer = setInterval(() => void track(processOnboarding()), 5_000);
  onboardingTimer.unref();
  void track(processOnboarding());
  log("info", "onboarding_processor_started", { interval_ms: 5_000 });

  async function processNotifications() {
    if (stopping || notificationBusy) return;
    notificationBusy = true;
    try {
      await processNextNotificationOpportunity({ createSpace: spaceId => iMessage.space.get(spaceId) });
    } catch (error) {
      log("error", "notification_processing_failed", { error_type: errorType(error) });
    } finally {
      notificationBusy = false;
    }
  }

  const notificationTimer = setInterval(() => void track(processNotifications()), 5_000);
  notificationTimer.unref();
  void track(processNotifications());
  log("info", "notification_processor_started", { interval_ms: 5_000 });

  function stop(reason: "SIGINT" | "SIGTERM" | "inbound_stream_ended") {
    if (stopPromise) return stopPromise;
    stopping = true;
    clearInterval(onboardingTimer);
    clearInterval(notificationTimer);
    log("info", "worker_stopping", { reason });
    stopPromise = (async () => {
      await Promise.allSettled([...inFlight]);
      await app.stop();
      log("info", "worker_stopped", { reason });
    })().catch(error => {
      log("error", "worker_shutdown_failed", { error_type: errorType(error) });
      process.exitCode = 1;
    });
    return stopPromise;
  }
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  async function processInbound(space: WorkerPhotonSpace, message: PhotonMessageLike) {
    try {
      const inbound = parsePhotonInbound(space, message);
      if (!inbound || stopping) return;
      log("info", "inbound_message_received");
      await withNotificationDeliveryGate(inbound.conversationId, () => space.responding(async () => {
        const result = await routePhotonMessage(inbound, {
          defaultCity: process.env.PHOTON_DEFAULT_CITY || "Miami, FL",
        });
        if (result.duplicate) {
          log("info", "inbound_duplicate_ignored");
          return;
        }
        if (result.response) {
          const sent = await sendOutput(space, inbound.senderId, result.response, "dibs_reply");
          const followup = followupScheduleRequest(inbound, result, sent.textMessages);
          if (followup) {
            await scheduleUnansweredFollowup(followup.userId, followup.inboundMessageId, followup.outboundMessageId)
              .catch(error => log("warn", "notification_scheduling_failed", { error_type: errorType(error) }));
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
      log("error", "inbound_message_processing_failed", { error_type: errorType(error) });
      if (!stopping) {
        await sendPhotonReply(space, "Sorry, I couldn't process that message right now. Please try again shortly.")
          .catch(replyError => log("error", "inbound_error_reply_failed", { error_type: errorType(replyError) }));
      }
    }
  }

  log("info", "inbound_message_listener_started");
  for await (const [space, message] of app.messages) {
    if (stopping) break;
    await track(processInbound(space, message));
  }
  if (!stopping) {
    process.exitCode = 1;
    await stop("inbound_stream_ended");
  }
  else await stopPromise;
}

main().catch((error) => {
  log("error", "worker_failed", { error_type: errorType(error) });
  process.exit(1);
});
