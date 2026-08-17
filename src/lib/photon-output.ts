import { attachment, type ContentBuilder } from "spectrum-ts";
import type { OutboundMessage } from "./messaging";
import { sanitizeOutboundMessage } from "./imessage-text";

export type PhotonOutputSpace = {
  id: string;
  send(content: string | ContentBuilder): Promise<{ id?: string; timestamp?: Date } | undefined>;
};
export type PhotonOutputKind = "dibs_reply" | "dibs_relay" | "dibs_attachment";
export type RecordPhotonOutput = (
  sent: { id?: string; timestamp?: Date } | undefined,
  spaceId: string,
  identity: string,
  kind: PhotonOutputKind,
) => Promise<void>;

export async function sendOrderedPhotonOutput(
  space: PhotonOutputSpace,
  identity: string,
  output: OutboundMessage,
  kind: Exclude<PhotonOutputKind, "dibs_attachment">,
  recordSent: RecordPhotonOutput,
): Promise<{ textMessages: Array<{ id: string; occurredAt: string }> }> {
  const sanitized = sanitizeOutboundMessage(output);
  const parts = sanitized.parts || [{ type: "text" as const, text: sanitized.text }];
  const textMessages: Array<{ id: string; occurredAt: string }> = [];
  for (const [index, part] of parts.entries()) {
    if (part.type === "text") {
      try {
        const sent = await space.send(part.text);
        await recordSent(sent, space.id, identity, kind);
        if (sent?.id) textMessages.push({ id: sent.id, occurredAt: (sent.timestamp || new Date()).toISOString() });
      } catch (error) {
        console.warn("Could not send Photon text", error instanceof Error ? error.message : "Unknown error");
        break;
      }
      continue;
    }
    try {
      const listing = part.listingNumber || 1;
      const photo = part.photoNumber || index + 1;
      const sent = await space.send(attachment(new URL(part.imageUrl), { name: `listing-${listing}-photo-${photo}.jpg` }));
      await recordSent(sent, space.id, identity, "dibs_attachment");
    } catch (error) {
      console.warn("Could not send listing photo", error instanceof Error ? error.message : "Unknown error");
    }
  }
  return { textMessages };
}