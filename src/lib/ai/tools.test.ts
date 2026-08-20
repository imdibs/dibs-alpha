import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingSession } from "../marketplace";
import type { Listing } from "../types";
import { createToolExecutor, type ToolDependencies } from "./tools";
import { listingDescription } from "../seller-listing";

const trusted = { userId: "trusted-user", normalizedIdentity: "+13055550123", inboundMessageId: "inbound-1", photonSpaceId: "space-1", defaultCity: "Miami, FL", currentMessageText: "yes" };
const draft = { title: "PS5 DualSense controller", category: "electronics" as const, age: "Bought 2 months ago.", functionality: "Works perfectly.", defects: "No scratches or stick drift.", includedItems: "Includes controller and cable.", packaging: "No original box.", condition: "like_new" as const, priceCents: 4000, city: "Miami", photos: [{ id: "p", path: "trusted-user/p.jpg", url: "https://photo" }, { id: "q", path: "trusted-user/q.jpg", url: "https://photo-2" }] };
const session = (overrides: Partial<MessagingSession> = {}): MessagingSession => ({
  identity: trusted.normalizedIdentity, user_id: trusted.userId, photon_space_id: trusted.photonSpaceId,
  recent_listing_ids: [], recent_conversation_ids: [], recent_owned_listing_ids: [], context_kind: "seller",
  selected_listing_id: null, active_conversation_id: null, seller_draft: null, seller_draft_version: 0, pending_listing_action: null, ...overrides,
});
const owned: Listing = { id: "owned-1", seller_id: trusted.userId, title: "My PS5", description: "works", price_cents: 30000, condition: "good", city: "Miami", image_urls: ["one", "two", "three"], status: "active", created_at: "now" };

describe("actor-bound marketplace AI tools", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  let state: MessagingSession;
  let deps: ToolDependencies;
  let published: Listing | null;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.test";
    state = session();
    published = null;
    deps = {
      search: vi.fn(), getSession: vi.fn(async () => state),
      saveSession: vi.fn(async (_identity, patch) => { state = { ...state, ...patch }; }),
      getListing: vi.fn(async id => id === owned.id ? owned as never : id === published?.id ? published as never : null), getOwned: vi.fn(async () => [owned]),
      createListing: vi.fn(async (userId, input, id) => {
        published = { id: id!, seller_id: userId, title: input.title!, description: listingDescription(input), price_cents: input.priceCents!, condition: input.condition!, city: input.city!, image_urls: input.photos.map((photo: { url: string }) => photo.url), status: "draft", created_at: "now", public_token: "AbCdEf123456" };
        return { id: id! };
      }), activateListing: vi.fn(async () => { if (published) published = { ...published, status: "active" }; }), updateListing: vi.fn(async () => undefined), deleteDraftPhotos: vi.fn(async () => undefined), updateProfile: vi.fn(async () => undefined), recordEvent: vi.fn(async () => undefined),
    };
  });
  afterAll(() => {
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it("patches all seller fields in one validated operation without bypassing review", async () => {
    const execute = createToolExecutor(trusted, deps);
    state = session({ seller_draft: { photos: draft.photos }, seller_draft_version: 4 });
    const { photos: _photos, ...patch } = draft;
    const result = await execute({ name: "updateSellerDraft", arguments: { patch } });
    expect(result).toMatchObject({ ok: true, data: { version: 5, missingField: null, readyToReview: true } });
    expect(state.seller_draft).toMatchObject({ title: "PS5 DualSense controller", condition: "like_new", priceCents: 4000, city: "Miami" });
    expect(state.pending_listing_action).toBeNull();
  });

  it("merges multiple buyer-facing seller facts and returns the captured draft", async () => {
    const execute = createToolExecutor(trusted, deps);
    state = session({ seller_draft: { title: "PS5 Disc", photos: draft.photos, description: "About a year old." }, seller_draft_version: 2 });
    const result = await execute({ name: "updateSellerDraft", arguments: { patch: { condition: "good", description: "Works perfectly. Tiny scratch on the side. Comes with two controllers." } } });
    expect(result).toMatchObject({ ok: true, data: { draft: { title: "PS5 Disc", condition: "good", description: "About a year old. Works perfectly. Tiny scratch on the side. Comes with two controllers." } } });
    expect(state.seller_draft?.description).toBe("About a year old. Works perfectly. Tiny scratch on the side. Comes with two controllers.");
  });

  it("shows exactly two initial results, stores the ranked pool, and never exposes the third automatically", async () => {
    const listings = Array.from({ length: 5 }, (_, index) => ({ ...owned, id: `listing-${index + 1}`, title: `PS5 ${index + 1}`, description: `Seller detail ${index + 1}` }));
    deps.getListing = vi.fn(async id => listings.find(item => item.id === id) as never);
    deps.search = vi.fn(async () => ({ intent: { query: "ps5", maxPriceCents: 30000, city: "Miami" }, listings }));
    const result = await createToolExecutor(trusted, deps)({ name: "searchListings", arguments: { query: "ps5", maxPriceCents: 30000, city: "Miami" } });
    expect(result).toMatchObject({ ok: true, data: { listings: [
      { title: "PS5 1", description: "Seller detail 1" },
      { title: "PS5 2", description: "Seller detail 2" },
    ] } });
    expect((result.data as { listings: unknown[] }).listings).toHaveLength(2);
    expect(JSON.stringify(result.data)).not.toContain("PS5 3");
    expect(state.recent_listing_ids).toEqual(listings.map(item => item.id));
    expect(state.selected_listing_id).toBeNull();

    const more = await createToolExecutor(trusted, deps)({ name: "getRecentSearchResults", arguments: {} });
    expect(more).toMatchObject({ ok: true, data: { listings: [{ title: "PS5 3" }, { title: "PS5 4" }], hasMore: true } });
    expect(state.recent_listing_ids).toEqual(["listing-3", "listing-4", "listing-5"]);
    const firstInCurrentBatch = await createToolExecutor(trusted, deps)({ name: "getListing", arguments: { listingNumber: 1, photoMode: "none" } });
    expect(firstInCurrentBatch).toMatchObject({ ok: true, data: { title: "PS5 3", displayedOrdinal: 1 } });
    expect(state.selected_listing_id).toBe("listing-3");

    const last = await createToolExecutor(trusted, deps)({ name: "getRecentSearchResults", arguments: {} });
    expect(last).toMatchObject({ ok: true, data: { listings: [{ title: "PS5 5" }], hasMore: false } });
    const none = await createToolExecutor(trusted, deps)({ name: "getRecentSearchResults", arguments: {} });
    expect(none).toMatchObject({ ok: true, data: { listings: [], hasMore: false } });
  });

  it("removes internal listing markers and retrieves owned listings only for the trusted actor", async () => {
    const marked = { ...owned, title: "[ALPHA TEST] PS5 controller", description: "[ALPHA TEST] includes cable" };
    deps.getOwned = vi.fn(async userId => userId === trusted.userId ? [marked] : []);
    const result = await createToolExecutor(trusted, deps)({ name: "getOwnedListings", arguments: {} });
    expect(deps.getOwned).toHaveBeenCalledWith(trusted.userId);
    expect(result).toMatchObject({ ok: true, data: { listings: [{ title: "PS5 controller", description: "includes cable" }], total: 1 } });
    expect(state.recent_owned_listing_ids).toEqual([owned.id]);
    expect(state.context_kind).toBe("listings");
  });

  it("rejects model-controlled identity fields", async () => {
    const execute = createToolExecutor(trusted, deps);
    const result = await execute({ name: "updateSellerDraft", arguments: { patch: { title: "Controller" }, userId: "attacker", recipientPhoneNumber: "+13055550999" } });
    expect(result.ok).toBe(false);
    expect(deps.saveSession).not.toHaveBeenCalled();
  });

  it("updates only explicit profile fields for the trusted actor", async () => {
    const execute = createToolExecutor(trusted, deps);
    expect(await execute({ name: "updateUserProfile", arguments: { name: "Sam", city: "Coral Gables" } })).toMatchObject({
      ok: true, data: { saved: true, name: "Sam", city: "Coral Gables" },
    });
    expect(deps.updateProfile).toHaveBeenCalledWith("trusted-user", { name: "Sam", city: "Coral Gables" });

    expect((await execute({ name: "updateUserProfile", arguments: { name: "Sam", userId: "attacker" } })).ok).toBe(false);
    expect(deps.updateProfile).toHaveBeenCalledTimes(1);
  });

  it("stores an explicit neighborhood in the existing profile location field", async () => {
    const result = await createToolExecutor(trusted, deps)({ name: "updateUserProfile", arguments: { neighborhood: "Wynwood" } });
    expect(result).toMatchObject({ ok: true, data: { saved: true, neighborhood: "Wynwood", city: "Wynwood" } });
    expect(deps.updateProfile).toHaveBeenCalledWith("trusted-user", { city: "Wynwood" });
  });

  it("publishes only a matching complete draft version and always uses the trusted actor", async () => {
    const execute = createToolExecutor(trusted, deps);
    state = session({ seller_draft: draft, seller_draft_version: 7, pending_listing_action: { type: "publish", draftVersion: 7, preparedByInboundMessageId: "review-message" } });
    expect((await execute({ name: "publishListing", arguments: { expectedDraftVersion: 6 } })).ok).toBe(false);
    expect(deps.createListing).not.toHaveBeenCalled();
    const publishResult = await execute({ name: "publishListing", arguments: { expectedDraftVersion: 7 } });
    expect(publishResult, JSON.stringify(publishResult)).toMatchObject({ ok: true });
    expect(deps.createListing).toHaveBeenCalledWith("trusted-user", draft, expect.any(String));
    expect(state.seller_draft).toBeNull();
    expect(state.pending_listing_action).toBeNull();
  });

  it("rejects publishing in the same inbound turn as the review", async () => {
    state = session({ seller_draft: draft, seller_draft_version: 7 });
    const execute = createToolExecutor(trusted, deps);
    expect((await execute({ name: "reviewSellerDraft", arguments: {} })).ok).toBe(true);
    const result = await execute({ name: "publishListing", arguments: { expectedDraftVersion: 7 } });
    expect(result).toMatchObject({ ok: false, error: "Publishing needs a separate explicit confirmation." });
    expect(deps.createListing).not.toHaveBeenCalled();
  });

  it("leaves a verified listing in draft when the public origin is missing", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    state = session({ seller_draft: draft, seller_draft_version: 7, pending_listing_action: { type: "publish", draftVersion: 7, listingId: "publish-id", preparedByInboundMessageId: "review-message" } });
    published = { id: "publish-id", seller_id: trusted.userId, title: draft.title, description: listingDescription(draft), price_cents: draft.priceCents, condition: draft.condition, city: draft.city, image_urls: draft.photos.map(photo => photo.url), status: "draft", created_at: "now", public_token: "AbCdEf123456" };
    const result = await createToolExecutor(trusted, deps)({ name: "publishListing", arguments: { expectedDraftVersion: 7 } });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("NEXT_PUBLIC_SITE_URL") });
    expect(deps.activateListing).not.toHaveBeenCalled();
    expect(published.status).toBe("draft");
    expect(state.seller_draft).toEqual(draft);
  });

  it.each([
    ["missing listing", null],
    ["wrong actor", { ...owned, id: "publish-id", seller_id: "other-user", title: draft.title, description: [draft.age, draft.functionality, draft.defects, draft.includedItems, draft.packaging].join(" "), price_cents: draft.priceCents, condition: draft.condition, city: draft.city, image_urls: draft.photos.map(photo => photo.url) }],
    ["mismatched fields", { ...owned, id: "publish-id", seller_id: trusted.userId, title: draft.title, description: "wrong", price_cents: draft.priceCents, condition: draft.condition, city: draft.city, image_urls: draft.photos.map(photo => photo.url) }],
  ] as const)("keeps the draft when publish verification finds %s", async (_label, verification) => {
    state = session({ seller_draft: draft, seller_draft_version: 7, pending_listing_action: { type: "publish", draftVersion: 7, listingId: "publish-id", preparedByInboundMessageId: "review-message" } });
    deps.createListing = vi.fn(async () => ({ id: "publish-id" }));
    deps.getListing = vi.fn(async () => verification as never);
    const result = await createToolExecutor(trusted, deps)({ name: "publishListing", arguments: { expectedDraftVersion: 7 } });
    expect(result).toMatchObject({ ok: false });
    expect(state.seller_draft).toEqual(draft);
    expect(state.pending_listing_action).toEqual({ type: "publish", draftVersion: 7, listingId: "publish-id", preparedByInboundMessageId: "review-message" });
  });

  it("retries verification without creating a duplicate listing", async () => {
    const existing: Listing = { id: "publish-id", seller_id: trusted.userId, title: draft.title, description: listingDescription(draft), price_cents: draft.priceCents, condition: draft.condition, city: draft.city, image_urls: draft.photos.map(photo => photo.url), status: "active", created_at: "now", public_token: "AbCdEf123456" };
    state = session({ seller_draft: draft, seller_draft_version: 7, pending_listing_action: { type: "publish", draftVersion: 7, listingId: existing.id, preparedByInboundMessageId: "review-message" } });
    deps.getListing = vi.fn(async () => existing as never);
    const result = await createToolExecutor(trusted, deps)({ name: "publishListing", arguments: { expectedDraftVersion: 7 } });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { published: true, verified: true } });
    expect(deps.createListing).not.toHaveBeenCalled();
  });

  it("requires two calls for owned listing mutations and binds ownership server-side", async () => {
    const prepare = createToolExecutor(trusted, deps);
    const first = await prepare({ name: "updateOwnedListingPrice", arguments: { listingNumber: 1, priceCents: 27500 } });
    expect(first).toMatchObject({ ok: true, data: { confirmationRequired: true } });
    expect(deps.updateListing).not.toHaveBeenCalled();
    const confirm = createToolExecutor({ ...trusted, inboundMessageId: "inbound-2" }, deps);
    const second = await confirm({ name: "updateOwnedListingPrice", arguments: { listingNumber: 1, priceCents: 27500, confirm: true } });
    expect(second).toMatchObject({ ok: true, data: { updated: true } });
    expect(deps.updateListing).toHaveBeenCalledWith("trusted-user", "owned-1", { price_cents: 27500 });
  });

  it("returns only remaining photos for an explicit follow-up", async () => {
    state = session({ recent_listing_ids: [owned.id], selected_listing_id: owned.id });
    const result = await createToolExecutor(trusted, deps)({ name: "getSelectedListing", arguments: { photoMode: "remaining" } });
    expect(result).toMatchObject({ ok: true, data: { attachmentPhotoUrls: ["three"], photoCount: 3 } });
  });

  it("returns the actor-bound displayed ordinal for a selected listing", async () => {
    state = session({ recent_listing_ids: ["other", owned.id] });
    const result = await createToolExecutor(trusted, deps)({ name: "getListing", arguments: { listingNumber: 2, photoMode: "none" } });
    expect(result).toMatchObject({ ok: true, data: { displayedOrdinal: 2, title: "My PS5" } });
  });

  it("connects with no model-controlled arguments using trusted buyer and selected listing", async () => {
    state = session({ selected_listing_id: owned.id });
    deps.connectMarketplace = vi.fn(async () => ({ conversationId: "conversation-1", providerSpaceId: "group-1", status: "connected", reused: false }));
    const result = await createToolExecutor(trusted, deps)({ name: "connectBuyerToSeller", arguments: {} });
    expect(result).toMatchObject({ ok: true, data: { status: "connected" } });
    expect(deps.connectMarketplace).toHaveBeenCalledWith({ buyerId: trusted.userId, selectedListingId: owned.id });
  });

  it("rejects connect arguments and requires a selected listing", async () => {
    deps.connectMarketplace = vi.fn();
    expect((await createToolExecutor(trusted, deps)({ name: "connectBuyerToSeller", arguments: { sellerId: "attacker" } })).ok).toBe(false);
    expect((await createToolExecutor(trusted, deps)({ name: "connectBuyerToSeller", arguments: {} })).ok).toBe(false);
    expect(deps.connectMarketplace).not.toHaveBeenCalled();
  });
});