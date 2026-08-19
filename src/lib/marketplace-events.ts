export type MarketplaceEventType =
  | "seller_responded" | "buyer_responded" | "offer_made" | "counter_offer"
  | "offer_accepted" | "offer_rejected" | "deal_likely_closed" | "deal_failed" | "conversation_stalled";

export type DerivedMarketplaceEvent = {
  type: MarketplaceEventType;
  priceCents?: number;
  confidence: number;
  source: "deterministic_conversation_classification";
};

function priceCents(text: string): number | undefined {
  const match = text.match(/(?:\$\s*|\b)(\d{2,6})(?:\.\d{1,2})?\b/);
  return match ? Math.round(Number(match[1]) * 100) : undefined;
}

export function deriveMarketplaceEvents(
  text: string,
  role: "buyer" | "seller",
  previousOffer?: { role: "buyer" | "seller"; priceCents: number } | null,
): DerivedMarketplaceEvent[] {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return [];
  const events: DerivedMarketplaceEvent[] = [{
    type: role === "buyer" ? "buyer_responded" : "seller_responded",
    confidence: 1,
    source: "deterministic_conversation_classification",
  }];
  const price = priceCents(normalized);
  const offerLanguage = /\b(?:offer|take|do|would you|can you|how about|lowest|works)\b/.test(normalized);
  if (price && offerLanguage) {
    events.push({
      type: previousOffer && previousOffer.role !== role ? "counter_offer" : "offer_made",
      priceCents: price,
      confidence: 0.9,
      source: "deterministic_conversation_classification",
    });
  }
  if (/\b(?:deal|i accept|accepted|you got it|that works|works for me|yeah[,. ]+\$?\d+)\b/.test(normalized)) {
    events.push({ type: "offer_accepted", priceCents: price || previousOffer?.priceCents, confidence: 0.88, source: "deterministic_conversation_classification" });
  } else if (/\b(?:no deal|pass|not interested|can't do that|cannot do that|offer rejected)\b/.test(normalized)) {
    events.push({ type: "offer_rejected", priceCents: price || previousOffer?.priceCents, confidence: 0.9, source: "deterministic_conversation_classification" });
  }
  if (/\b(?:sold to you|payment (?:sent|received)|picked it up|deal is done)\b/.test(normalized)) {
    events.push({ type: "deal_likely_closed", priceCents: price || previousOffer?.priceCents, confidence: 0.75, source: "deterministic_conversation_classification" });
  }
  return events;
}