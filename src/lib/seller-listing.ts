export type ListingCondition = "new" | "like_new" | "good" | "fair";

export type SellerPhoto = { id: string; path: string; url: string };
export type ListingCategory = "electronics" | "furniture" | "clothing" | "other";
export type SellerDraft = {
  title?: string;
  suggestedTitle?: string;
  condition?: ListingCondition;
  priceCents?: number;
  city?: string;
  description?: string;
  category?: ListingCategory;
  age?: string;
  functionality?: string;
  defects?: string;
  includedItems?: string;
  packaging?: string;
  size?: string;
  dimensions?: string;
  material?: string;
  photos: SellerPhoto[];
};

export type PendingListingAction =
  | { type: "publish"; draftVersion?: number; listingId?: string; preparedByInboundMessageId?: string }
  | { type: "share"; listingId: string }
  | { type: "remove"; listingId: string; title: string; preparedByInboundMessageId?: string }
  | { type: "sold"; listingId: string; title: string; preparedByInboundMessageId?: string }
  | { type: "price"; listingId: string; title: string; priceCents: number; preparedByInboundMessageId?: string };

export function wantsToSell(text: string): boolean {
  return /\b(?:i\s*(?:wanna|want to|need to|would like to)|help me)\s+(?:sell|list)|\b(?:sell|selling|listing|list)\s+(?:something|this|my\b)|\bi'?m selling\b/i.test(text);
}

export function wantsOwnListings(text: string): boolean {
  return /\b(?:show|what(?:'s| is| do)?|list)\b.*\b(?:my|i)\b.*\b(?:selling|listings?|listed)\b|\bwhat am i selling\b/i.test(text);
}

export function wantsCancel(text: string): boolean {
  return /^\s*(?:start over|cancel|forget (?:this|the) listing|never ?mind)\s*[.!]?\s*$/i.test(text);
}

export function isConfirmation(text: string): boolean {
  return /^\s*(?:yeah|yep|yes|yup|do it|post it|looks good|put it up|go ahead|sure|mark it sold|remove it)\s*[.!]?\s*$/i.test(text);
}

export function isShareConfirmation(text: string): boolean {
  return /^\s*(?:yes|yeah|yep|yup|sure|please|(?:(?:yes|yeah|yep|yup|sure),?\s+)?(?:send it(?:\s+to\s+my\s+friend)?|send (?:me )?(?:the )?link))\s*[.!]?\s*$/i.test(text);
}

export function isShareDecline(text: string): boolean {
  return /^\s*(?:no|nope|nah|no thanks|not now|i'm good|im good)\s*[.!]?\s*$/i.test(text);
}

export function parsePrice(text: string, allowBare = false): number | undefined {
  const explicit = text.match(/(?:\$|price\s+(?:to\s+)?|for\s+|make it\s+|to\s+)([\d,]+(?:\.\d{1,2})?)/i);
  const bare = allowBare ? text.trim().match(/^\$?([\d,]+(?:\.\d{1,2})?)\s*$/) : null;
  const value = explicit?.[1] || bare?.[1];
  if (!value) return undefined;
  const dollars = Number(value.replaceAll(",", ""));
  if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 1_000_000) return undefined;
  return Math.round(dollars * 100);
}

export function parseCondition(text: string): ListingCondition | undefined {
  if (/\blike[ -]?new\b/i.test(text)) return "like_new";
  if (/\bbrand[ -]?new\b|^\s*new\s*[.!]?$/i.test(text)) return "new";
  if (/\bgood\b/i.test(text)) return "good";
  if (/\bfair\b/i.test(text)) return "fair";
  return undefined;
}

export function parseSellTitle(text: string): string | undefined {
  const match = text.match(/\b(?:sell|selling|list|listing)\s+(?:my\s+|this\s+|a\s+|an\s+)?(.+?)(?=\s+(?:for\s+)?\$[\d,]+|\s+for\s+[\d,]+|[.!?]|$)/i);
  const value = match?.[1]?.replace(/^(?:something|this)$/i, "").trim();
  return value && value.length >= 2 ? value.slice(0, 120) : undefined;
}

export function applySellerText(draft: SellerDraft, text: string): SellerDraft {
  const next = { ...draft };
  const correctingTitle = text.match(/\b(?:call it|title it)\s+(.+?)\s*[.!]?$/i)?.[1]?.trim();
  const description = text.match(/\badd that\s+(.+?)\s*[.!]?$/i)?.[1]?.trim();
  const price = parsePrice(text, !draft.priceCents);
  const condition = parseCondition(text);
  if (correctingTitle) next.title = correctingTitle.slice(0, 120);
  if (description) next.description = [draft.description, description].filter(Boolean).join(" ").slice(0, 2000);
  if (price) next.priceCents = price;
  if (condition) next.condition = condition;
  if (!next.title) next.title = parseSellTitle(text);
  return next;
}

export function applySellerReply(draft: SellerDraft, text: string): SellerDraft {
  let next = applySellerText(draft, text);
  const clean = text.trim().replace(/[.!?]+$/, "").trim();
  if (!next.title && draft.suggestedTitle && isConfirmation(text)) next = { ...next, title: draft.suggestedTitle };
  if (!next.title && draft.photos.length && clean.length >= 2 && clean.length <= 120 && !parseCondition(clean) && !parsePrice(clean, true)) {
    next = { ...next, title: clean };
  }
  const correctedCity = text.match(/\b(?:i(?:'m| am) in|city(?: is)?|location(?: is)?|change (?:the )?(?:city|location) to)\s+([a-z][a-z .'-]{1,80})\s*[.!]?$/i)?.[1]?.trim();
  if (correctedCity) next = { ...next, city: correctedCity };
  else if (!next.city && next.title && next.condition && next.priceCents && /^[a-z][a-z .'-]{1,80}$/i.test(clean) && !isConfirmation(clean)) {
    next = { ...next, city: clean };
  }
  return next;
}

export type DraftField = "title" | "category" | "age" | "condition" | "functionality" | "defects" | "includedItems" | "packaging" | "size" | "dimensions" | "material" | "price" | "city" | "photos";

export function missingDraftFields(draft: SellerDraft): DraftField[] {
  const missing: DraftField[] = [];
  if (!draft.title) missing.push("title");
  if (!draft.category) missing.push("category");
  if (!draft.priceCents) missing.push("price");
  if (!draft.condition) missing.push("condition");
  if (!draft.city) missing.push("city");
  if (draft.category === "electronics") {
    if (!draft.age) missing.push("age");
    if (!draft.functionality) missing.push("functionality");
    if (!draft.defects) missing.push("defects");
    if (!draft.includedItems) missing.push("includedItems");
    if (!draft.packaging) missing.push("packaging");
  } else if (draft.category === "furniture") {
    if (!draft.age) missing.push("age");
    if (!draft.dimensions) missing.push("dimensions");
    if (!draft.defects) missing.push("defects");
    if (!draft.material) missing.push("material");
  } else if (draft.category === "clothing") {
    if (!draft.size) missing.push("size");
    if (!draft.defects) missing.push("defects");
  }
  if (draft.photos.length < 2) missing.push("photos");
  return missing;
}

export function missingDraftField(draft: SellerDraft): DraftField | null {
  const fields = missingDraftFields(draft);
  return Array.isArray(fields) ? fields[0] || null : fields;
}

export function nextDraftQuestion(draft: SellerDraft): string {
  switch (missingDraftField(draft)) {
    case "photos": return draft.photos.length === 1 ? "send me one more pic and we're good." : "yeah, send me a couple pics";
    case "title": return draft.suggestedTitle
      ? `looks like ${draft.suggestedTitle}. is that what you're selling?`
      : "what exactly are you selling here?";
    case "condition": return "nice. what condition is it in?";
    case "category": return "what kind of item is it?";
    case "age": return "about how old is it?";
    case "functionality": return "is everything working properly?";
    case "defects": return "any scratches, damage, or issues?";
    case "includedItems": return "what comes with it?";
    case "packaging": return "do you still have the original box or packaging?";
    case "size": return "what size is it?";
    case "dimensions": return "what are the dimensions?";
    case "material": return "what material is it?";
    case "price": return "nice. how much you thinking?";
    case "city": return "what city?";
    default: return reviewDraft(draft);
  }
}

export function reviewDraft(draft: SellerDraft): string {
  const condition = draft.condition === "like_new" ? "Like new" : `${draft.condition?.[0].toUpperCase()}${draft.condition?.slice(1)}`;
  const details = [draft.age, draft.functionality, draft.defects, draft.includedItems, draft.packaging, draft.size, draft.dimensions, draft.material].filter(Boolean);
  return `here's what I've got:\n\n${draft.title}\n$${((draft.priceCents || 0) / 100).toLocaleString("en-US")}\n${condition}\n${details.join("\n")}${details.length ? "\n" : ""}${draft.city}\n${draft.photos.length} photo${draft.photos.length === 1 ? "" : "s"}\n\nyou good with me putting it up?`;
}

export function listingDescription(draft: SellerDraft): string {
  const condition = draft.condition === "like_new" ? "like new" : draft.condition;
  const facts = [draft.description?.trim(), draft.age, draft.functionality, draft.defects, draft.includedItems, draft.packaging, draft.size, draft.dimensions, draft.material].filter(Boolean);
  return (facts.length ? facts.join(" ") : `${draft.title} in ${condition} condition.`).slice(0, 2000);
}

export async function suggestTitleFromPhoto(imageUrl: string): Promise<string | undefined> {
  // Photo understanding belongs at the single Dibs AI boundary. Phase 1 safely
  // records the photo and asks for a title rather than invoking a second model.
  void imageUrl;
  return undefined;
}