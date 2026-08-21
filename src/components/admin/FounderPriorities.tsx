import type { DealAnalytics, MarketplaceFunnel, MarketplaceOverview } from "@/lib/admin-analytics";

export function FounderPriorities({ overview, funnel, deals }: { overview: MarketplaceOverview; funnel: MarketplaceFunnel; deals: DealAnalytics }) {
  const published = funnel.find(stage => stage.label === "Published listings")?.count || 0;
  const conversations = funnel.find(stage => stage.label === "Buyer conversations")?.count || 0;
  const introductions = funnel.find(stage => stage.label === "Verified introductions")?.count || 0;
  const priorities = [
    overview.active_listings.value === 0 ? { title: "Publish the first active listing.", action: "Review the strongest draft and remove whatever is blocking it from going live today." } : null,
    published > 0 && conversations === 0 ? { title: "Create buyer demand for published supply.", action: "Choose the strongest published listings and seed buyer outreach today." } : null,
    conversations > 0 && introductions === 0 ? { title: "Fix the conversation-to-introduction handoff.", action: "Review recent buyer conversations and find the first point where a qualified match stalls." } : null,
    introductions > 0 && deals.totalDeals === 0 ? { title: "Learn why verified introductions are not closing.", action: "Follow up with both sides of the newest introductions and capture the blocker." } : null,
    overview.listings.change !== null && overview.listings.change < 0 ? { title: "Rebuild listing creation momentum.", action: "Review recent drafts and seller conversations, then unblock the highest-quality listing today." } : null,
  ].filter((value): value is { title: string; action: string } => Boolean(value));
  const priority = priorities[0];
  return <section className="mc-priorities"><p className="mc-kicker">Founder priority</p><h2>{priority?.title || "Keep compounding the marketplace loop."}</h2>
    <p>{priority?.action || "Protect what is working: review today’s newest supply and follow through on open introductions."}</p></section>;
}