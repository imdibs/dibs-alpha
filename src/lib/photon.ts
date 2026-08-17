import type { InboundMessage, MessagingAttachment } from "./messaging";

export type PhotonMessageLike = {
  id?: string;
  direction?: string;
  sender?: { id?: string };
  timestamp?: Date;
  content?: unknown;
};
export type PhotonSpaceLike = { id?: string; send(text: string): Promise<unknown> };

type PhotonContent = Record<string, unknown>;

function contentRecord(message: PhotonMessageLike): Record<string, unknown> | undefined {
  return message.content && typeof message.content === "object" ? message.content as Record<string, unknown> : undefined;
}

export function parsePhotonInbound(space: PhotonSpaceLike, message: PhotonMessageLike): InboundMessage | undefined {
  const content = contentRecord(message);
  if (message.direction !== "inbound" || !message.id || !content) return undefined;
  const parts: PhotonContent[] = content.type === "group" && Array.isArray(content.items)
    ? content.items.flatMap(item => {
      if (!item || typeof item !== "object") return [];
      const child = (item as { content?: unknown }).content;
      return child && typeof child === "object" ? [child as PhotonContent] : [];
    })
    : [content];
  const text = parts
    .filter(part => part.type === "text" && typeof part.text === "string")
    .map(part => part.text as string)
    .filter(part => part.trim())
    .join("\n");
  const attachments = parts.flatMap(part => {
    const attachment = photonAttachmentMetadata({ content: part });
    return attachment ? [attachment] : [];
  });
  if (!text.trim() && !attachments.length) return undefined;
  return {
    messageId: message.id,
    conversationId: space.id || "unknown",
    senderId: message.sender?.id || "",
    occurredAt: (message.timestamp || new Date()).toISOString(),
    text,
    attachments,
  };
}

export function photonAttachmentMetadata(message: PhotonMessageLike): MessagingAttachment | undefined {
  const content = contentRecord(message);
  if (content?.type !== "attachment" || typeof content.id !== "string" || typeof content.read !== "function") return undefined;
  return {
    id: content.id,
    name: typeof content.name === "string" ? content.name : undefined,
    mimeType: typeof content.mimeType === "string" ? content.mimeType : undefined,
    size: typeof content.size === "number" ? content.size : undefined,
    read: content.read as () => Promise<Buffer>,
  };
}

export function buildPhotonReply(conversationId: string, text: string) {
  if (!conversationId || !text.trim()) throw new Error("Photon reply requires a conversation and text.");
  return { conversationId, text: text.trim() };
}

export async function sendPhotonReply(space: PhotonSpaceLike, text: string): Promise<void> {
  const reply = buildPhotonReply(space.id || "", text);
  await space.send(reply.text);
}