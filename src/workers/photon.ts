import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import type { OutboundMessage } from "../lib/messaging";
import { recordOutboundEvent } from "../lib/marketplace";
import { parsePhotonInbound, sendPhotonReply } from "../lib/photon";
import { sendOrderedPhotonOutput, type PhotonOutputSpace } from "../lib/photon-output";
import { routePhotonMessage } from "../lib/photon-router";

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

  async function recordSent(sent: { id?: string } | undefined, spaceId: string, identity: string, kind: "dibs_reply" | "dibs_relay" | "dibs_attachment") {
    if (sent?.id) await recordOutboundEvent({ messageId: sent.id, spaceId, identity, kind });
  }

  async function sendOutput(
    space: PhotonOutputSpace,
    identity: string,
    output: OutboundMessage,
    kind: "dibs_reply" | "dibs_relay",
  ) {
    await sendOrderedPhotonOutput(space, identity, output, kind, recordSent);
  }

  async function stop(signal: string) {
    console.log(`Stopping Dibs Photon worker (${signal}).`);
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
      await space.responding(async () => {
        const result = await routePhotonMessage(inbound, {
          defaultCity: process.env.PHOTON_DEFAULT_CITY || "Miami, FL",
        });
        if (result.duplicate) {
          console.log("Ignored duplicate Photon message", { messageId: inbound.messageId });
          return;
        }
        if (result.response) await sendOutput(space, inbound.senderId, result.response, "dibs_reply");
        if (result.relay) {
          const relaySpace = process.env.PHOTON_IMESSAGE_LINE
            ? await iMessage.space.create(result.relay.identity, { phone: process.env.PHOTON_IMESSAGE_LINE })
            : await iMessage.space.create(result.relay.identity);
          await sendOutput(relaySpace, result.relay.identity, result.relay.message, "dibs_relay");
        }
      });
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