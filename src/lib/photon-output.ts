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

const SENSITIVE_ENV_NAME = /(secret|token|password|credential|api_?key|service_?role|private_?key)/i;

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Non-Error value thrown";
  let message = error.message;
  for (const [name, configuredValue] of Object.entries(process.env)) {
    if (SENSITIVE_ENV_NAME.test(name) && configuredValue && configuredValue.length >= 8) {
      message = message.split(configuredValue).join("[REDACTED]");
    }
  }
  return message
    .replace(/\b(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|credential)\b\s*[:=]\s*(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_TOKEN]")
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[REDACTED_URL]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/(^|[^\w])\+?\d[\d ().-]{7,}\d(?=$|[^\w])/g, "$1[REDACTED_PHONE]")
    .slice(0, 500);
}

function errorType(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(error.name) ? error.name : "Error";
}

function logOutputFailure(level: "warn" | "error", event: string, error: unknown, spaceId: string, kind: PhotonOutputKind): void {
  const entry = JSON.stringify({
    level,
    event,
    service: "dibs-photon-output",
    error_type: errorType(error),
    error_message: safeErrorMessage(error),
    space_id: spaceId.slice(0, 200),
    message_kind: kind,
  });
  if (level === "error") console.error(entry);
  else console.warn(entry);
}

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
      let sent: Awaited<ReturnType<PhotonOutputSpace["send"]>>;
      try {
        sent = await space.send(part.text);
      } catch (error) {
        logOutputFailure("error", "photon_text_send_failed", error, space.id, kind);
        throw error;
      }
      if (sent?.id) textMessages.push({ id: sent.id, occurredAt: (sent.timestamp || new Date()).toISOString() });
      try {
        await recordSent(sent, space.id, identity, kind);
      } catch (error) {
        logOutputFailure("warn", "photon_outbound_recording_failed", error, space.id, kind);
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