import { z } from "zod";
import { searchListingsByIntent, type ListingSearchResult } from "../listing-search";
import {
  activateOwnedDraftListing, activeListingsForSeller, createListingFromDraft, deleteSellerDraftPhotos, getMessagingSession,
  listingForMessaging, saveMessagingSession, updateIMessageUserProfile, updateOwnedListing,
} from "../marketplace";
import { listingDescription, missingDraftField, missingDraftFields, reviewDraft, type SellerDraft } from "../seller-listing";
import { randomUUID } from "node:crypto";
import type { Listing } from "../types";
import { displayListingTitle } from "../messaging";
import { isConfirmation } from "../seller-listing";
import { publicListingUrl } from "../public-listings";
import { recordProductEvent } from "../analytics";
import type { ToolName, ToolRequest, ToolResult, TrustedToolContext } from "./types";

const condition = z.enum(["new", "like_new", "good", "fair"]);
const draftPatch = z.object({
  title: z.string().trim().min(2).max(120).optional(), condition: condition.optional(),
  priceCents: z.number().int().positive().max(100_000_000).optional(),
  city: z.string().trim().min(2).max(100).optional(), description: z.string().trim().min(3).max(2000).optional(),
  category: z.enum(["electronics", "furniture", "clothing", "other"]).optional(),
  age: z.string().trim().min(2).max(200).optional(), functionality: z.string().trim().min(2).max(500).optional(),
  defects: z.string().trim().min(2).max(500).optional(), includedItems: z.string().trim().min(2).max(500).optional(),
  packaging: z.string().trim().min(2).max(300).optional(), size: z.string().trim().min(1).max(100).optional(),
  dimensions: z.string().trim().min(2).max(200).optional(), material: z.string().trim().min(2).max(200).optional(),
}).strict();
const listingNumber = z.object({ listingNumber: z.number().int().min(1).max(2).optional(), photoMode: z.enum(["initial", "remaining", "none"]).optional() }).strict();
const empty = z.object({}).strict();

export type ToolDependencies = {
  search: typeof searchListingsByIntent;
  getSession: typeof getMessagingSession;
  saveSession: typeof saveMessagingSession;
  getListing: typeof listingForMessaging;
  getOwned: typeof activeListingsForSeller;
  createListing: typeof createListingFromDraft;
  activateListing: typeof activateOwnedDraftListing;
  updateListing: typeof updateOwnedListing;
  deleteDraftPhotos: typeof deleteSellerDraftPhotos;
  updateProfile: typeof updateIMessageUserProfile;
  recordEvent?: typeof recordProductEvent;
  connectMarketplace?: (trusted: { buyerId: string; selectedListingId: string }) => Promise<unknown>;
};
const defaults: ToolDependencies = {
  search: searchListingsByIntent, getSession: getMessagingSession, saveSession: saveMessagingSession,
  getListing: listingForMessaging, getOwned: activeListingsForSeller, createListing: createListingFromDraft, activateListing: activateOwnedDraftListing,
  updateListing: updateOwnedListing, deleteDraftPhotos: deleteSellerDraftPhotos, updateProfile: updateIMessageUserProfile, recordEvent: recordProductEvent,
};

function publicListing(listing: Listing) {
  return { title: displayListingTitle(listing.title), description: listing.description.replace(/\[ALPHA TEST\]/gi, "").trim().slice(0, 2000), priceCents: listing.price_cents, city: listing.city, condition: listing.condition, photoUrls: listing.image_urls, photoCount: listing.image_urls.length, status: listing.status };
}

function listingMatchesDraft(listing: Listing, userId: string, draft: SellerDraft, status: "draft" | "active"): boolean {
  const expectedDescription = listingDescription(draft);
  return listing.seller_id === userId && listing.status === status && listing.title === draft.title
    && listing.price_cents === draft.priceCents && listing.condition === draft.condition && listing.city === draft.city
    && listing.description === expectedDescription
    && listing.image_urls.length === draft.photos.length
    && draft.photos.every(photo => listing.image_urls.includes(photo.url));
}

async function selectedListing(context: TrustedToolContext, args: unknown, deps: ToolDependencies): Promise<Listing | null> {
  const { listingNumber: number } = listingNumber.parse(args);
  const session = await deps.getSession(context.normalizedIdentity);
  const id = number ? session?.recent_listing_ids[number - 1] : session?.selected_listing_id;
  if (!id) return null;
  const listing = await deps.getListing(id);
  return listing && listing.status === "active" ? listing as unknown as Listing : null;
}

export function createToolExecutor(context: TrustedToolContext, overrides: Partial<ToolDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (request: ToolRequest): Promise<ToolResult> => {
    try {
      let data: unknown;
      switch (request.name) {
        case "updateUserProfile": {
          const values = z.object({
            name: z.string().trim().min(1).max(80).optional(),
            city: z.string().trim().min(1).max(100).optional(),
          }).strict().refine(value => value.name !== undefined || value.city !== undefined).parse(request.arguments);
          await deps.updateProfile(context.userId, values);
          data = { saved: true, ...values };
          break;
        }
        case "searchListings": {
          const args = z.object({ query: z.string().trim().min(2).max(120), maxPriceCents: z.number().int().positive().max(100_000_000).nullable().optional(), city: z.string().trim().min(2).max(100).nullable().optional() }).strict().parse(request.arguments);
          const result: ListingSearchResult = await deps.search({ query: args.query, maxPriceCents: args.maxPriceCents || undefined, city: args.city || context.defaultCity });
          const pool = result.listings.slice(0, 12);
          const shown = pool.slice(0, 2);
          await deps.saveSession(context.normalizedIdentity, { recent_listing_ids: pool.map(item => item.id), selected_listing_id: null, active_conversation_id: null, context_kind: "search" });
          data = { intent: result.intent, listings: shown.map(publicListing) };
          break;
        }
        case "getListing": case "getSelectedListing": {
          const args = listingNumber.parse(request.arguments);
          const listing = await selectedListing(context, request.arguments, deps);
          if (!listing) throw new Error("That listing isn't available.");
          const session = await deps.getSession(context.normalizedIdentity);
          await deps.saveSession(context.normalizedIdentity, { selected_listing_id: listing.id, context_kind: "search" });
          const ordinalIndex = session?.recent_listing_ids.indexOf(listing.id) ?? -1;
          data = { ...publicListing(listing), displayedOrdinal: ordinalIndex >= 0 ? ordinalIndex + 1 : null, photoMode: args.photoMode || "none", attachmentPhotoUrls: args.photoMode === "remaining" ? listing.image_urls.slice(2) : args.photoMode === "initial" ? listing.image_urls.slice(0, 2) : [] };
          break;
        }
        case "getRecentSearchResults": {
          empty.parse(request.arguments);
          const session = await deps.getSession(context.normalizedIdentity);
          const remainingIds = (session?.recent_listing_ids || []).slice(2);
          const rows = await Promise.all(remainingIds.slice(0, 2).map(id => deps.getListing(id)));
          const shown = rows.filter(row => Boolean(row && row.status === "active")) as unknown as Listing[];
          await deps.saveSession(context.normalizedIdentity, { recent_listing_ids: remainingIds, selected_listing_id: null, context_kind: "search" });
          data = { listings: shown.map(publicListing), hasMore: remainingIds.length > 2 };
          break;
        }
        case "getCurrentSellerDraft": {
          empty.parse(request.arguments); const session = await deps.getSession(context.normalizedIdentity);
          data = { draft: session?.seller_draft || null, version: session?.seller_draft_version || 0 }; break;
        }
        case "getOwnedListings": {
          empty.parse(request.arguments);
          const owned = await deps.getOwned(context.userId);
          const shown = owned.slice(0, 2);
          await deps.saveSession(context.normalizedIdentity, { recent_owned_listing_ids: owned.map(item => item.id), recent_listing_ids: owned.map(item => item.id), selected_listing_id: null, context_kind: "listings" });
          data = { listings: shown.map(publicListing), total: owned.length };
          break;
        }
        case "getActiveConversation": empty.parse(request.arguments); data = { available: false, reason: "Buyer/seller relay tools are deferred in Phase 1." }; break;
        case "getRecentConversationHistory": empty.parse(request.arguments); data = { availableInPrompt: true }; break;
        case "connectBuyerToSeller": {
          empty.parse(request.arguments);
          const session = await deps.getSession(context.normalizedIdentity);
          if (!session?.selected_listing_id) throw new Error("Select a listing before asking to connect.");
          if (!deps.connectMarketplace) throw new Error("Real iMessage groups are unavailable; the private relay remains available.");
          data = await deps.connectMarketplace({ buyerId: context.userId, selectedListingId: session.selected_listing_id });
          break;
        }
        case "updateSellerDraft": {
          const args = z.object({ patch: draftPatch }).strict().parse(request.arguments);
          const session = await deps.getSession(context.normalizedIdentity);
          const current = session?.seller_draft;
          const description = args.patch.description
            ? [current?.description, args.patch.description].filter(Boolean).join(" ").slice(0, 2000)
            : current?.description;
          const draft: SellerDraft = { photos: [], ...(current || {}), ...args.patch, description };
          const version = (session?.seller_draft_version || 0) + 1;
          const missingFields = missingDraftFields(draft);
          const complete = missingFields.length === 0;
          await deps.saveSession(context.normalizedIdentity, { seller_draft: draft, seller_draft_version: version, pending_listing_action: null, context_kind: "seller", active_conversation_id: null });
          data = { draft, version, missingField: missingFields[0] || null, missingFields, readyToReview: complete };
          break;
        }
        case "discardSellerDraft": {
          empty.parse(request.arguments); const session = await deps.getSession(context.normalizedIdentity);
          await deps.deleteDraftPhotos(session?.seller_draft); await deps.saveSession(context.normalizedIdentity, { seller_draft: null, pending_listing_action: null, seller_draft_version: (session?.seller_draft_version || 0) + 1, context_kind: "search" });
          data = { discarded: true }; break;
        }
        case "reviewSellerDraft": {
          empty.parse(request.arguments); const session = await deps.getSession(context.normalizedIdentity); const draft = session?.seller_draft;
          if (!draft || missingDraftField(draft)) throw new Error(`The draft still needs ${draft ? missingDraftField(draft) : "details"}.`);
          const version = session?.seller_draft_version || 0;
          const listingId = session?.pending_listing_action?.type === "publish" && session.pending_listing_action.draftVersion === version
            ? session.pending_listing_action.listingId || randomUUID() : randomUUID();
          await deps.saveSession(context.normalizedIdentity, { pending_listing_action: { type: "publish", draftVersion: version, listingId, preparedByInboundMessageId: context.inboundMessageId }, context_kind: "seller" });
          data = { review: reviewDraft(draft), version, confirmationRequired: true }; break;
        }
        case "publishListing": {
          const args = z.object({ expectedDraftVersion: z.number().int().nonnegative() }).strict().parse(request.arguments);
          const session = await deps.getSession(context.normalizedIdentity); const pending = session?.pending_listing_action;
          if (!session?.seller_draft || pending?.type !== "publish" || pending.draftVersion !== args.expectedDraftVersion || session.seller_draft_version !== args.expectedDraftVersion) throw new Error("There isn't a matching confirmed publish action.");
          if (!pending.preparedByInboundMessageId || pending.preparedByInboundMessageId === context.inboundMessageId || !isConfirmation(context.currentMessageText || "")) throw new Error("Publishing needs a separate explicit confirmation.");
          if (missingDraftField(session.seller_draft)) throw new Error("That listing still needs important details.");
          const listingId = pending.listingId || randomUUID();
          if (!pending.listingId) await deps.saveSession(context.normalizedIdentity, { pending_listing_action: { ...pending, listingId } });
          let verified = await deps.getListing(listingId) as unknown as Listing | null;
          if (!verified) {
            await deps.createListing(context.userId, session.seller_draft, listingId);
            verified = await deps.getListing(listingId) as unknown as Listing | null;
          }
          if (!verified) throw new Error("The publish could not be verified. Your draft is still saved; try again safely.");
          if (verified.status === "draft") {
            if (!listingMatchesDraft(verified, context.userId, session.seller_draft, "draft")) throw new Error("The publish could not be verified. Your draft is still saved; try again safely.");
            await deps.activateListing(context.userId, listingId);
            verified = await deps.getListing(listingId) as unknown as Listing | null;
          }
          if (!verified || !listingMatchesDraft(verified, context.userId, session.seller_draft, "active")) throw new Error("The publish could not be verified. Your draft is still saved; try again safely.");
          if (!verified.public_token) throw new Error("The publish could not be verified. Your draft is still saved; try again safely.");
          const shareUrl = publicListingUrl(verified.public_token);
          await deps.saveSession(context.normalizedIdentity, { seller_draft: null, pending_listing_action: null, selected_listing_id: listingId, context_kind: "search" });
          await deps.recordEvent?.({ eventName: "listing_published", userId: context.userId, listingId, metadata: { verified: true } }).catch(error => console.warn("Could not record publish event", error));
          await deps.recordEvent?.({ eventName: "listing_share_link_generated", userId: context.userId, listingId, metadata: { channel: "imessage_publish" } }).catch(error => console.warn("Could not record share event", error));
          data = { published: true, verified: true, title: displayListingTitle(verified.title), priceCents: verified.price_cents, city: verified.city, shareUrl }; break;
        }
        case "updateOwnedListingPrice": case "markOwnedListingSold": case "removeOwnedListing": {
          const args = z.object({ listingNumber: z.number().int().min(1).max(20), priceCents: z.number().int().positive().max(100_000_000).optional(), confirm: z.boolean().optional() }).strict().parse(request.arguments);
          const session = await deps.getSession(context.normalizedIdentity); const owned = await deps.getOwned(context.userId); const listing = owned[args.listingNumber - 1];
          if (!listing) throw new Error("I couldn't find that active listing.");
          const type = request.name === "updateOwnedListingPrice" ? "price" : request.name === "markOwnedListingSold" ? "sold" : "remove";
          if (type === "price" && !args.priceCents) throw new Error("A valid price is required.");
          const pendingAction = session?.pending_listing_action;
          const matches = pendingAction?.type === type && pendingAction.listingId === listing.id && pendingAction.preparedByInboundMessageId !== context.inboundMessageId && (pendingAction.type !== "price" || pendingAction.priceCents === args.priceCents);
          if (!args.confirm || !matches) {
            const pending = type === "price" ? { type, listingId: listing.id, title: listing.title, priceCents: args.priceCents!, preparedByInboundMessageId: context.inboundMessageId } as const : { type, listingId: listing.id, title: listing.title, preparedByInboundMessageId: context.inboundMessageId } as const;
            await deps.saveSession(context.normalizedIdentity, { pending_listing_action: pending, recent_owned_listing_ids: owned.map(item => item.id), context_kind: "listings" });
            data = { confirmationRequired: true, action: type, title: listing.title, priceCents: args.priceCents }; break;
          }
          if (!isConfirmation(context.currentMessageText || "")) throw new Error("That change needs a separate explicit confirmation.");
          await deps.updateListing(context.userId, listing.id, type === "price" ? { price_cents: args.priceCents! } : { status: type === "sold" ? "sold" : "removed" });
          await deps.saveSession(context.normalizedIdentity, { pending_listing_action: null }); data = { updated: true, action: type }; break;
        }
        default: throw new Error(`Unsupported tool: ${request.name satisfies never}`);
      }
      return { name: request.name, ok: true, data };
    } catch (error) { return { name: request.name, ok: false, error: error instanceof Error ? error.message : "Tool failed." }; }
  };
}