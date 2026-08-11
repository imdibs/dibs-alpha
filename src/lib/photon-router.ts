import type { AiClient, AgentContext, ToolRequest, ToolResult } from "./ai/types";
import { runDibsAgent } from "./ai/dibs-agent";
import { appendAiTurn, loadAiHistory } from "./ai/memory";
import { createToolExecutor, type ToolDependencies } from "./ai/tools";
import {
  claimInboundEvent, completePhotonEvent, conversationDetails, getMessagingSession, listingForMessaging,
  normalizeIMessageIdentity, persistDibsMessage, persistParticipantMessage, recognizeIMessageUser,
  saveMessagingSession, uploadSellerPhotos,
} from "./marketplace";
import { renderRelay, type InboundMessage, type OutboundMessage } from "./messaging";
import { sanitizeOutboundMessage } from "./imessage-text";
import type { Listing } from "./types";

export type PhotonRouterDependencies = {
  aiClient?: AiClient;
  executeTool?: (request: ToolRequest) => Promise<ToolResult>;
  toolDependencies?: Partial<ToolDependencies>;
  loadHistory?: typeof loadAiHistory;
  appendHistory?: typeof appendAiTurn;
};
export type PhotonRouterResult = {
  response?: OutboundMessage;
  relay?: { identity: string; message: OutboundMessage; conversationId: string; sourceMessageId: string };
  duplicate?: boolean;
};

async function loadListings(ids: string[]): Promise<Listing[]> {
  const rows = await Promise.all(ids.slice(0, 12).map(id => listingForMessaging(id)));
  return rows.filter(row => Boolean(row && row.status === "active")) as unknown as Listing[];
}

export async function routePhotonMessage(message: InboundMessage, options: PhotonRouterDependencies & { defaultCity?: string } = {}): Promise<PhotonRouterResult> {
  const identity = normalizeIMessageIdentity(message.senderId);
  if (!identity) return { response: { text: "I couldn't verify that iMessage sender." } };
  if (!await claimInboundEvent(message.messageId, message.conversationId, identity)) return { duplicate: true };
  try {
    const recognized = await recognizeIMessageUser(identity);
    if (!recognized) throw new Error("I couldn't recognize this iMessage account.");
    const user = recognized.user;
    let session = await getMessagingSession(identity);
    await saveMessagingSession(identity, { user_id: user.id, photon_space_id: message.conversationId });

    // Phase 1 deliberately leaves the canonical, participant-authorized relay path unchanged.
    if (session?.active_conversation_id && session.context_kind === "chats" && !message.attachments.length) {
      const conversation = await conversationDetails(session.active_conversation_id);
      if (conversation && [conversation.buyer_id, conversation.seller_id].includes(user.id)) {
        const role = conversation.buyer_id === user.id ? "buyer" : "seller";
        const recipient = role === "buyer" ? conversation.seller : conversation.buyer;
        if (!recipient.imessage_address) throw new Error("I can't reach that person through Dibs right now.");
        const participant = await persistParticipantMessage({ conversation, senderId: user.id, body: message.text, providerMessageId: message.messageId });
        const relayText = renderRelay(role, message.text, conversation.listing.title);
        await persistDibsMessage({ conversationId: conversation.id, body: relayText, kind: "dibs_outbound", inReplyToMessageId: participant.id });
        await completePhotonEvent(message.messageId);
        return { relay: { identity: recipient.imessage_address, message: { text: relayText }, conversationId: conversation.id, sourceMessageId: participant.id } };
      }
    }

    if (message.attachments.length) {
      const draft = session?.seller_draft || { photos: [], city: user.city || undefined };
      const photos = await uploadSellerPhotos(user.id, message.attachments, draft.photos);
      const version = (session?.seller_draft_version || 0) + 1;
      await saveMessagingSession(identity, { seller_draft: { ...draft, photos }, seller_draft_version: version, pending_listing_action: null, context_kind: "seller", active_conversation_id: null });
      session = await getMessagingSession(identity);
    }

    const historyLoader = options.loadHistory || loadAiHistory;
    const historyAppender = options.appendHistory || appendAiTurn;
    const history = await historyLoader(user.id);
    await historyAppender(user.id, { role: "user", body: message.text || `[sent ${message.attachments.length} photo attachment(s)]` }, message.messageId);
    const recentListings = await loadListings((session?.recent_listing_ids || []).slice(0, 2));
    const selectedListing = session?.selected_listing_id ? await listingForMessaging(session.selected_listing_id) as Listing | null : null;
    const context: AgentContext = { session, history, sellerDraft: session?.seller_draft || null, recentListings, selectedListing };
    const trusted = { userId: user.id, normalizedIdentity: identity, inboundMessageId: message.messageId, photonSpaceId: message.conversationId, defaultCity: options.defaultCity || user.city || "Miami, FL" };
    const executeTool = options.executeTool || createToolExecutor(trusted, options.toolDependencies);
    const result = await runDibsAgent({ text: message.text, context, trusted }, { client: options.aiClient, executeTool });
    await historyAppender(user.id, { role: "tool", body: JSON.stringify(result.toolResults) });
    const introduction = recognized.isNew ? "yo, i'm Dibs, save this number so you can find me later." : "";
    const text = [introduction, result.text].filter(Boolean).join("\n\n");
    const parts = introduction
      ? [{ type: "text" as const, text: introduction }, ...(result.parts || [{ type: "text" as const, text: result.text }])]
      : result.parts;
    const response = sanitizeOutboundMessage({ text, parts });
    await historyAppender(user.id, { role: "assistant", body: response.text });
    await completePhotonEvent(message.messageId);
    return { response };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    await completePhotonEvent(message.messageId, reason);
    return { response: { text: "I'm having trouble thinking right now. your stuff is still saved. Try me again in a bit." } };
  }
}