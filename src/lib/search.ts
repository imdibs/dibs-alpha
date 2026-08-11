import type { SearchIntent } from "./types";

const filler = /\b(find|show|looking|search|want|need|buy|me|for|a|an|the|used|near|please)\b/gi;
export function parseSearchFallback(input: string, defaultCity?: string): SearchIntent {
  const price = input.match(/(?:under|below|less than|max(?:imum)?|up to)\s*\$?([\d,]+)/i);
  const withoutNearMe = input.replace(/\bnear\s+me\b/gi, " ");
  const near = withoutNearMe.match(/\b(?:near|in)\s+([a-z][a-z .'-]{1,40})(?=$|[,.]|\s+(?:under|below|for)\b)/i);
  const query = input
    .replace(/\bnear\s+me\b/gi, " ")
    .replace(/(?:under|below|less than|max(?:imum)?|up to)\s*\$?[\d,]+/gi, " ")
    .replace(/\b(?:near|in)\s+[a-z][a-z .'-]{1,40}(?=$|[,.])/gi, " ")
    .replace(filler, " ").replace(/\s+/g, " ").trim();
  return {
    query: query || input.trim(),
    maxPriceCents: price ? Number(price[1].replaceAll(",", "")) * 100 : undefined,
    city: near?.[1].trim() || defaultCity,
  };
}

export async function understandSearch(input: string, defaultCity?: string): Promise<SearchIntent> {
  return parseSearchFallback(input, defaultCity);
}