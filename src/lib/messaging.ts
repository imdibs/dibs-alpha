import { searchListings, type ListingSearchResult } from "./listing-search";
import type { Listing } from "./types";

export type MessagingAttachment = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: number;
  read: () => Promise<Buffer>;
};
export type OutboundPart =
  | { type: "text"; text: string }
  | { type: "image"; imageUrl: string; listingNumber?: number; photoNumber?: number };
export type OutboundMessage = { text: string; parts?: OutboundPart[] };
export type InboundMessage = {
  messageId: string;
  conversationId: string;
  senderId: string;
  occurredAt: string;
  text: string;
  attachments: MessagingAttachment[];
  providerLine?: string;
};

type Search = (input: string, defaultCity?: string) => Promise<ListingSearchResult>;

export function formatSearchResults(result: ListingSearchResult): string {
  const { intent, listings } = result;
  const city = intent.city || "your area";
  const price = intent.maxPriceCents ? ` under $${(intent.maxPriceCents / 100).toLocaleString("en-US")}` : "";
  if (!listings.length) return `I couldn't find any ${intent.query}${price} near ${city} right now. Try a broader search?`;
  const shown = listings.slice(0, 2);
  const heading = `Found ${listings.length} ${intent.query}${price} near ${city}:`;
  const rows = shown.map((listing: Listing, index: number) =>
    `${index + 1}. ${displayListingTitle(listing.title)} — $${(listing.price_cents / 100).toLocaleString("en-US")}\n   ${listing.city}`
  );
  return `${heading}\n\n${rows.join("\n\n")}\n\nWant me to show you the best one?`;
}

export function displayListingTitle(title: string): string {
  return title.replace(/^\s*\[ALPHA TEST\]\s*/i, "").trim();
}

export function renderRelay(role: "buyer" | "seller", body: string, listingTitle: string): string {
  const title = displayListingTitle(listingTitle);
  return role === "buyer"
    ? `yo, someone is asking about ${title}: “${body}”`
    : `the seller replied about ${title}: “${body}”`;
}

export async function routeInboundMessage(
  message: InboundMessage,
  options: { defaultCity?: string; search?: Search } = {},
): Promise<string> {
  if (!message.senderId) throw new Error("Inbound message is missing a sender.");
  if (!message.text.trim()) return "Send me what you're looking for and your budget.";
  const result = await (options.search || searchListings)(message.text, options.defaultCity || "Miami, FL");
  return formatSearchResults(result);
}