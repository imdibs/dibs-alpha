import { runDibsAgent } from "../src/lib/ai/dibs-agent";
import type { AgentContext, ToolRequest, ToolResult, TrustedToolContext } from "../src/lib/ai/types";
import type { Listing } from "../src/lib/types";
import type { MessagingSession } from "../src/lib/marketplace";

if (process.env.DIBS_RUN_REAL_MODEL_EVAL !== "1") {
  throw new Error("Set DIBS_RUN_REAL_MODEL_EVAL=1 to run this guarded, read-only evaluation.");
}

const trusted: TrustedToolContext = { userId: "eval-user", normalizedIdentity: "+13055550000", inboundMessageId: "eval-message", photonSpaceId: "eval-space", defaultCity: "Miami" };
const baseSession = (overrides: Partial<MessagingSession> = {}): MessagingSession => ({ identity: trusted.normalizedIdentity, user_id: trusted.userId, photon_space_id: trusted.photonSpaceId, recent_listing_ids: [], recent_conversation_ids: [], context_kind: "search", selected_listing_id: null, active_conversation_id: null, seller_draft: null, seller_draft_version: 0, pending_listing_action: null, recent_owned_listing_ids: [], ...overrides });
const listings: Listing[] = [
  { id: "eval-1", seller_id: "seller-1", title: "PS5 Disc Edition", description: "Includes controller and power cable.", price_cents: 22500, condition: "good", city: "Miami", image_urls: ["https://example.test/1-a.jpg", "https://example.test/1-b.jpg"], status: "active", created_at: "now" },
  { id: "eval-2", seller_id: "seller-2", title: "PS5 Digital Edition", description: "Includes DualSense controller.", price_cents: 26500, condition: "like_new", city: "Miami", image_urls: ["https://example.test/2-a.jpg"], status: "active", created_at: "now" },
  { id: "eval-3", seller_id: "seller-3", title: "PS5 Slim Bundle", description: "Includes stand and HDMI cable.", price_cents: 29500, condition: "good", city: "Miami", image_urls: ["https://example.test/3-a.jpg", "https://example.test/3-b.jpg", "https://example.test/3-c.jpg"], status: "active", created_at: "now" },
  { id: "eval-4", seller_id: "seller-4", title: "PS5 Digital Bundle", description: "Includes controller, stand, and charging cable.", price_cents: 28500, condition: "like_new", city: "Miami", image_urls: ["https://example.test/4-a.jpg", "https://example.test/4-b.jpg", "https://example.test/4-c.jpg"], status: "active", created_at: "now" },
];

let session = baseSession();
let sellerDraft: AgentContext["sellerDraft"] = null;
let recentListings: Listing[] = [];
let displayedListings: Listing[] = [];
let selectedListing: Listing | null = null;
let publishedListing: Listing | null = null;
const history: AgentContext["history"] = [];

async function executeTool(request: ToolRequest): Promise<ToolResult> {
  if (request.name === "searchListings") {
    recentListings = listings;
    displayedListings = listings.slice(0, 2);
    session = { ...session, recent_listing_ids: listings.map(item => item.id), selected_listing_id: null, context_kind: "search" };
    return { name: request.name, ok: true, data: { listings: displayedListings.map(item => ({ title: item.title, description: item.description, priceCents: item.price_cents, condition: item.condition, city: item.city, photoUrls: item.image_urls })) } };
  }
  if (request.name === "getRecentSearchResults") {
    const remainingIds = session.recent_listing_ids.slice(2);
    displayedListings = remainingIds.slice(0, 2).map(id => listings.find(item => item.id === id)).filter(Boolean) as Listing[];
    session = { ...session, recent_listing_ids: remainingIds, selected_listing_id: null };
    return { name: request.name, ok: true, data: { listings: displayedListings.map(item => ({ title: item.title, description: item.description, priceCents: item.price_cents, condition: item.condition, city: item.city, photoUrls: item.image_urls })), hasMore: remainingIds.length > 2 } };
  }
  if (request.name === "getListing") {
    const number = Number(request.arguments.listingNumber);
    selectedListing = displayedListings[number - 1] || null;
    if (!selectedListing) return { name: request.name, ok: false, error: "No displayed listing at that number." };
    session = { ...session, selected_listing_id: selectedListing.id };
    const mode = request.arguments.photoMode;
    return { name: request.name, ok: true, data: { title: selectedListing.title, description: selectedListing.description, priceCents: selectedListing.price_cents, condition: selectedListing.condition, city: selectedListing.city, displayedOrdinal: number, photoMode: mode || "none", attachmentPhotoUrls: mode === "remaining" ? selectedListing.image_urls.slice(2) : mode === "initial" ? selectedListing.image_urls.slice(0, 2) : [] } };
  }
  if (request.name === "getSelectedListing" && selectedListing) {
    return { name: request.name, ok: true, data: { title: selectedListing.title, description: selectedListing.description, priceCents: selectedListing.price_cents, condition: selectedListing.condition, city: selectedListing.city, displayedOrdinal: displayedListings.findIndex(item => item.id === selectedListing?.id) + 1, photoMode: request.arguments.photoMode || "none", attachmentPhotoUrls: request.arguments.photoMode === "remaining" ? selectedListing.image_urls.slice(2) : selectedListing.image_urls.slice(0, 2) } };
  }
  if (request.name === "getOwnedListings") {
    const owned = publishedListing ? [publishedListing] : [];
    return { name: request.name, ok: true, data: { listings: owned.map(item => ({ title: item.title, description: item.description, priceCents: item.price_cents, condition: item.condition, city: item.city, photoUrls: item.image_urls })), total: owned.length } };
  }
  if (request.name === "updateSellerDraft") {
    sellerDraft = { photos: sellerDraft?.photos || [], ...(sellerDraft || {}), ...(request.arguments.patch as object) };
    session = { ...session, context_kind: "seller", seller_draft: sellerDraft, seller_draft_version: session.seller_draft_version + 1 };
    const known = sellerDraft as Record<string, unknown>;
    const missingFields = ["age", "functionality", "defects", "includedItems", "packaging", "city", "photos"].filter(field => field === "photos" ? !sellerDraft?.photos.length : !known[field]);
    return { name: request.name, ok: true, data: { draft: { ...sellerDraft, photos: undefined, photoCount: sellerDraft.photos.length }, missingFields, readyToReview: missingFields.length === 0 } };
  }
  if (request.name === "reviewSellerDraft" && sellerDraft) {
    const condition = sellerDraft.condition === "like_new" ? "Like new" : sellerDraft.condition;
    return { name: request.name, ok: true, data: { review: `here's what i've got:\n\n${sellerDraft.title}\n$${(sellerDraft.priceCents || 0) / 100} · ${condition} · ${sellerDraft.city}\n${[sellerDraft.age, sellerDraft.functionality, sellerDraft.defects, sellerDraft.includedItems, sellerDraft.packaging].filter(Boolean).join(" ")}\n\nyou good with me putting it up?`, version: session.seller_draft_version } };
  }
  if (request.name === "publishListing" && sellerDraft && session.pending_listing_action?.type === "publish") {
    publishedListing = { id: "eval-published", seller_id: trusted.userId, title: sellerDraft.title!, description: [sellerDraft.age, sellerDraft.functionality, sellerDraft.defects, sellerDraft.includedItems, sellerDraft.packaging].filter(Boolean).join(" "), price_cents: sellerDraft.priceCents!, condition: sellerDraft.condition!, city: sellerDraft.city!, image_urls: sellerDraft.photos.map(photo => photo.url), status: "active", created_at: "now" };
    selectedListing = publishedListing;
    session = { ...session, seller_draft: null, pending_listing_action: null, selected_listing_id: publishedListing.id, context_kind: "search" };
    sellerDraft = null;
    return { name: request.name, ok: true, data: { published: true, verified: true } };
  }
  return { name: request.name, ok: false, error: "This mutation is disabled in real-model evaluation." };
}

async function turn(text: string) {
  const context: AgentContext = { session, history: [...history], sellerDraft, recentListings, selectedListing };
  const result = await runDibsAgent({ text, context, trusted }, { executeTool });
  history.push({ role: "user", body: text }, { role: "tool", body: JSON.stringify(result.toolResults) }, { role: "assistant", body: result.text });
  console.log(`\nuser: ${text}\ndibs: ${result.text}`);
  if (/\*\*|^\s*#{1,6}\s|[—–]|\[ALPHA TEST\]|\p{Extended_Pictographic}/gmu.test(result.text)) {
    throw new Error(`Unsafe iMessage formatting in evaluator output: ${result.text}`);
  }
  const productParts = result.parts?.filter(part => part.type === "text" && /^\d+\/\d+\n/.test(part.text)) || [];
  for (const [index, part] of (result.parts || []).entries()) {
    if (part.type !== "image" || !part.listingNumber) continue;
    const precedingProduct = [...(result.parts || []).slice(0, index)].reverse().find((candidate): candidate is Extract<typeof candidate, { type: "text" }> => candidate.type === "text" && /^\d+\/\d+\n/.test(candidate.text));
    if (!precedingProduct || !precedingProduct.text.startsWith(`${part.listingNumber}/${productParts.length}\n`)) {
      throw new Error("Evaluator found a photo outside its authoritative product block.");
    }
  }
  return result;
}

async function main() {
  const phase = process.env.DIBS_EVAL_PHASE || "all";
  if (phase === "all" || phase === "buyer") {
    await turn("yo");
    await turn("I'm looking for a PS5");
    const initial = await turn("anything under $300");
    if (initial.parts?.filter(part => part.type === "text" && /^\d+\/2\n/.test(part.text)).length !== 2) throw new Error("Initial search did not render exactly two products.");
    await turn("1st");
    await turn("show me more pics");
    await turn("show me more");
    await turn("the first one");
  }
  if (phase === "all" || phase === "seller") {
    session = baseSession({ context_kind: "seller" }); sellerDraft = null; recentListings = []; selectedListing = null; history.length = 0;
    await turn("i wanna sell a ps5 controller for $30");
    await turn("bought it 2 months ago, works perfectly, no scratches, comes with the cable");
    sellerDraft = { ...(sellerDraft || {}), title: "PS5 controller", category: "electronics", priceCents: 3000, condition: "like_new", age: "Bought 2 months ago", functionality: "Works perfectly", defects: "No scratches or stick drift", includedItems: "Includes cable", packaging: "No original box", city: "Miami", photos: [{ id: "eval-photo-1", path: "memory/1.jpg", url: "https://example.test/published-1.jpg" }, { id: "eval-photo-2", path: "memory/2.jpg", url: "https://example.test/published-2.jpg" }] };
    session = { ...session, seller_draft: sellerDraft, seller_draft_version: session.seller_draft_version + 1, pending_listing_action: { type: "publish", draftVersion: session.seller_draft_version + 1 } };
    await turn("sent the pics. no box, i'm in Miami");
    await turn("put it up");
    await turn("can i see it?");
    await turn("what do I have listed?");
    if (!publishedListing) throw new Error("The in-memory evaluation did not reach verified publish.");
  }
}

void main();