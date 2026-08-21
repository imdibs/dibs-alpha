import { db } from "./db";
import { capturePostHog, type PostHogEvent } from "./posthog";
export { newTrackingToken, validAcquisitionSource as cleanSource } from "./tracking";

export const PUBLIC_EVENT_NAMES = ["listing_share_link_generated", "listing_page_viewed", "listing_cta_clicked"] as const;
export type PublicEventName = typeof PUBLIC_EVENT_NAMES[number];

export type ProductEvent = {
  eventName: string;
  userId?: string | null;
  listingId?: string | null;
  conversationId?: string | null;
  visitorId?: string | null;
  attributionToken?: string | null;
  source?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

export type CoreAnalytics = {
  total_users: number;
  total_introductions: number;
  total_listings: number;
  total_deals: number;
  active_listings: number;
  draft_listings: number;
  sold_listings: number;
};

async function exactCount(query: PromiseLike<{ count: number | null; error: { message?: string } | null }>, metric: string): Promise<number> {
  const result = await query;
  if (result.error || result.count === null) throw new Error(`Could not count ${metric}.`);
  return result.count;
}

export async function getCoreAnalytics(): Promise<CoreAnalytics> {
  const client = db();
  const count = (table: string) => client.from(table).select("id", { count: "exact", head: true });
  const [totalUsers, totalIntroductions, totalListings, totalDeals, activeListings, draftListings, soldListings] = await Promise.all([
    exactCount(count("users"), "users"),
    exactCount(count("conversations").in("connection_status", ["connected", "completed"]).eq("provider_group_type", "group").not("provider_space_id", "is", null).not("provider_line", "is", null).not("buyer_provider_identity", "is", null).not("seller_provider_identity", "is", null).not("provider_introduction_message_id", "is", null).not("connected_at", "is", null), "introductions"),
    exactCount(count("listings"), "listings"),
    exactCount(count("deals"), "deals"),
    exactCount(count("listings").eq("status", "active"), "active listings"),
    exactCount(count("listings").eq("status", "draft"), "draft listings"),
    exactCount(count("listings").eq("status", "sold"), "sold listings"),
  ]);
  return {
    total_users: totalUsers, total_introductions: totalIntroductions, total_listings: totalListings, total_deals: totalDeals,
    active_listings: activeListings, draft_listings: draftListings, sold_listings: soldListings,
  };
}

export function postHogEventsForProductEvent(event: ProductEvent): PostHogEvent[] {
  const common = { distinctId: event.userId, properties: { source: event.source, ...event.metadata } };
  switch (event.eventName) {
    case "alpha_onboarding_accepted":
      return [
        { event: "user_signed_up", ...common, properties: { source: event.source, city: event.metadata?.city, onboarding_method: "website" } },
        { event: "onboarding_started", ...common, properties: { source: event.source, onboarding_method: "website" } },
      ];
    case "alpha_user_replied":
      return [{ event: "first_message_received", ...common, properties: { channel: "imessage", message_kind: "onboarding_reply" } }];
    case "onboarding_completed":
      return [{ event: "onboarding_completed", ...common, properties: { source: event.source, onboarding_method: "imessage" } }];
    case "buyer_seller_conversation_started":
      return [{ event: "deal_started", ...common, properties: { channel: "marketplace" } }];
    default:
      return [];
  }
}

export async function recordProductEvent(event: ProductEvent): Promise<void> {
  const metadata = event.metadata || {};
  if (JSON.stringify(metadata).length > 2000) throw new Error("Product event metadata is too large.");
  const result = await db().from("product_events").insert({
    event_name: event.eventName,
    user_id: event.userId || null,
    listing_id: event.listingId || null,
    conversation_id: event.conversationId || null,
    visitor_id: event.visitorId || null,
    attribution_token: event.attributionToken || null,
    source: event.source?.slice(0, 100) || null,
    metadata,
  });
  if (result.error) throw new Error("Could not record product event.");
  for (const postHogEvent of postHogEventsForProductEvent(event)) capturePostHog(postHogEvent);
}