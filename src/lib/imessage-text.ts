import type { OutboundMessage, OutboundPart } from "./messaging";

export const SAFE_DIBS_FALLBACK = "what are you looking for?";

export function sanitizeIMessageText(value: string): string {
  return value
    .replace(/\[ALPHA TEST\]\s*/gi, "")
    .replace(/```[^\n]*\n?/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-+*][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, "$1 $2")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*+/g, "")
    .replace(/(^|[^\w])_([^_\n]+)_($|[^\w])/g, "$1$2$3")
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]*,[ \t]*,+/g, ", ")
    .trim();
}

export function sanitizeOutboundMessage(output: OutboundMessage): OutboundMessage {
  const fallback = sanitizeIMessageText(output.text) || SAFE_DIBS_FALLBACK;
  if (!output.parts) return { text: fallback };

  const seenText = new Set<string>();
  const parts = output.parts.flatMap<OutboundPart>(part => {
    if (part.type === "image") return [part];
    const text = sanitizeIMessageText(part.text);
    if (!text || seenText.has(text)) return [];
    seenText.add(text);
    return [{ type: "text", text }];
  });
  if (!parts.some(part => part.type === "text") && !parts.some(part => part.type === "image")) parts.unshift({ type: "text", text: fallback });
  return { text: fallback, parts };
}