import { db } from "./db";
import { deriveMarketplaceEvents, type PreviousMarketplaceOffer } from "./marketplace-events";
import { normalizeIMessageIdentity, persistParticipantMessage, type ConversationRecord } from "./marketplace";
import type { InboundMessage } from "./messaging";

export type GroupConversation = ConversationRecord & {
  provider_space_id: string;
  provider_line: string;
  buyer_provider_identity: string;
  seller_provider_identity: string;
  connection_status: string;
};

export type MarketplaceGroupRoutingRepository = {
  find(spaceId: string, providerLine: string): Promise<GroupConversation | null>;
  persistMessage(input: { conversation: ConversationRecord; senderId: string; body: string; providerMessageId: string }): Promise<{ id: string; replayed?: boolean }>;
  previousOffer(conversationId: string): Promise<PreviousMarketplaceOffer | null>;
  persistEvents(input: { conversation: GroupConversation; messageId: string; occurredAt: string; events: ReturnType<typeof deriveMarketplaceEvents> }): Promise<void>;
  confirmDeal(input: { conversation: GroupConversation; messageId: string; offer: PreviousMarketplaceOffer; priceCents: number; confidence: number; agreedAt: string }): Promise<void>;
};

function directDibsRequest(text: string): string | null {
  const match = text.trim().match(/^@?dibs(?:\s*[:,—-]\s*|\s+)(.*)$/i);
  return match ? match[1].trim() : null;
}

export const marketplaceGroupRoutingRepository: MarketplaceGroupRoutingRepository = {
  async find(spaceId, providerLine) {
    const result = await db().from("conversations")
      .select("id,listing_id,buyer_id,seller_id,provider_space_id,provider_line,buyer_provider_identity,seller_provider_identity,connection_status")
      .eq("provider_space_id", spaceId).eq("provider_line", providerLine).in("connection_status", ["connected", "completed"]).maybeSingle();
    if (result.error) throw new Error("Could not resolve marketplace group.");
    return result.data as GroupConversation | null;
  },
  async persistMessage(input) {
    try {
      return await persistParticipantMessage(input);
    } catch (error) {
      const existing = await db().from("messages").select("id").eq("provider_message_id", input.providerMessageId).maybeSingle();
      if (existing.data?.id) return { id: existing.data.id, replayed: true };
      throw error;
    }
  },
  async previousOffer(conversationId) {
    const result = await db().from("marketplace_events").select("event_type,price_cents,source_message_id,message:messages!source_message_id(participant_role)")
      .eq("conversation_id", conversationId).in("event_type", ["offer_made", "counter_offer", "offer_accepted", "offer_rejected"]).order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    if (result.error || !result.data?.price_cents || !["offer_made", "counter_offer"].includes(result.data.event_type)) return null;
    const message = result.data.message as unknown as { participant_role?: "buyer" | "seller" } | null;
    return message?.participant_role ? { role: message.participant_role, priceCents: result.data.price_cents, sourceMessageId: result.data.source_message_id } : null;
  },
  async persistEvents({ conversation, messageId, occurredAt, events }) {
    if (!events.length) return;
    const result = await db().from("marketplace_events").upsert(events.map(event => ({
      conversation_id: conversation.id, listing_id: conversation.listing_id, buyer_id: conversation.buyer_id, seller_id: conversation.seller_id,
      source_message_id: messageId, event_type: event.type, price_cents: event.priceCents || null,
      confidence: event.confidence, source: event.source, facts: {}, occurred_at: occurredAt,
    })), { onConflict: "source_message_id,event_type", ignoreDuplicates: true });
    if (result.error) throw new Error("Could not persist marketplace events.");
  },
  async confirmDeal({ conversation, messageId, offer, priceCents, confidence, agreedAt }) {
    const result = await db().rpc("confirm_marketplace_group_deal", {
      requested_conversation_id: conversation.id, requested_listing_id: conversation.listing_id,
      requested_buyer_id: conversation.buyer_id, requested_seller_id: conversation.seller_id,
      requested_price_cents: priceCents, requested_agreed_at: agreedAt,
      requested_offer_message_id: offer.sourceMessageId || null, requested_acceptance_message_id: messageId,
      requested_confidence: confidence,
    });
    if (result.error) throw new Error("Could not confirm marketplace deal.");
  },
};

export async function routeMarketplaceGroupMessage(
  message: InboundMessage,
  repository: MarketplaceGroupRoutingRepository = marketplaceGroupRoutingRepository,
): Promise<{ handled: boolean; conversation?: GroupConversation; senderId?: string; directText?: string }> {
  if (!message.providerLine) return { handled: false };
  const conversation = await repository.find(message.conversationId, message.providerLine);
  if (!conversation) return { handled: false };
  const sender = normalizeIMessageIdentity(message.senderId);
  if (sender === normalizeIMessageIdentity(message.providerLine)) return { handled: true };
  const buyer = normalizeIMessageIdentity(conversation.buyer_provider_identity);
  const seller = normalizeIMessageIdentity(conversation.seller_provider_identity);
  const senderId = sender === buyer ? conversation.buyer_id : sender === seller ? conversation.seller_id : null;
  if (!senderId) throw new Error("Marketplace group sender is not a persisted participant.");
  const body = message.text.trim() || `[sent ${message.attachments.length} attachment(s)]`;
  const persisted = await repository.persistMessage({ conversation, senderId, body, providerMessageId: message.messageId });
  if (persisted.replayed) return { handled: true, conversation, senderId };
  if (message.text.trim()) {
    const role = senderId === conversation.buyer_id ? "buyer" : "seller";
    const previousOffer = await repository.previousOffer(conversation.id);
    const events = deriveMarketplaceEvents(message.text, role, previousOffer);
    await repository.persistEvents({ conversation, messageId: persisted.id, occurredAt: message.occurredAt, events });
    const agreement = events.find(event => event.type === "deal_likely_closed" && event.confidence >= 0.95 && event.priceCents);
    if (agreement?.priceCents && previousOffer && previousOffer.role !== role) {
      await repository.confirmDeal({ conversation, messageId: persisted.id, offer: previousOffer, priceCents: agreement.priceCents, confidence: agreement.confidence, agreedAt: message.occurredAt });
    }
  }
  const directText = directDibsRequest(message.text);
  return { handled: true, conversation, senderId, ...(directText !== null ? { directText } : {}) };
}