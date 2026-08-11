import { db } from "./db";
import { understandSearch } from "./search";
import type { Listing, SearchIntent } from "./types";

export type ListingSearchResult = { intent: SearchIntent; listings: Listing[] };

export async function searchListings(input: string, defaultCity?: string): Promise<ListingSearchResult> {
  const intent = await understandSearch(input, defaultCity);
  return searchListingsByIntent(intent);
}

export async function searchListingsByIntent(intent: SearchIntent): Promise<ListingSearchResult> {
  let query = db().from("listings").select("*,seller:users!seller_id(name)").eq("status", "active").limit(12);
  const terms = intent.query.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(term => term.length > 1).join(" & ");
  if (terms) query = query.textSearch("search_document", terms, { type: "plain", config: "english" });
  if (intent.maxPriceCents) query = query.lte("price_cents", intent.maxPriceCents);
  if (intent.city) query = query.ilike("city", `%${intent.city}%`);
  const result = await query.order("created_at", { ascending: false });
  if (result.error) throw new Error("Search failed.");
  return { intent, listings: (result.data || []) as Listing[] };
}