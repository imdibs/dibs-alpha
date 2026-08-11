import { db } from "./db";
import type { MessagingAttachment } from "./messaging";
import { listingDescription, missingDraftField, type PendingListingAction, type SellerDraft, type SellerPhoto } from "./seller-listing";
import type { Listing } from "./types";

export type ConversationRecord = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
};

export type MessagingSession = {
  identity: string;
  user_id: string | null;
  photon_space_id: string | null;
  recent_listing_ids: string[];
  recent_conversation_ids: string[];
  context_kind: "search" | "chats" | "seller" | "listings";
  selected_listing_id: string | null;
  active_conversation_id: string | null;
  seller_draft: SellerDraft | null;
  seller_draft_version: number;
  pending_listing_action: PendingListingAction | null;
  recent_owned_listing_ids: string[];
};

export function normalizeIMessageIdentity(value: string): string | null {
  const identity = value.trim();
  if (!identity) return null;
  if (identity.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity) ? identity.toLowerCase() : null;
  const digits = identity.replace(/[^\d]/g, "");
  if (!identity.startsWith("+") || digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export type IMessageUser = {
  id: string;
  name: string | null;
  city: string | null;
  imessage_address: string;
};

async function userByNormalizedIdentity(normalized: string): Promise<IMessageUser | null> {
  const result = await db().from("users").select("id,name,city,imessage_address").eq("imessage_address", normalized).maybeSingle();
  if (result.error) throw new Error("Could not recognize this iMessage user.");
  return result.data as IMessageUser | null;
}

export async function recognizeIMessageUser(identity: string): Promise<{ user: IMessageUser; isNew: boolean } | null> {
  const normalized = normalizeIMessageIdentity(identity);
  if (!normalized) return null;
  const existing = await userByNormalizedIdentity(normalized);
  if (existing) return { user: existing, isNew: false };

  const created = await db().from("users").insert({ imessage_address: normalized }).select("id,name,city,imessage_address").single();
  if (!created.error && created.data) return { user: created.data as IMessageUser, isNew: true };

  // The unique identity index chooses one winner if two first messages race.
  const raced = await userByNormalizedIdentity(normalized);
  if (raced) return { user: raced, isNew: false };
  throw new Error("Could not recognize this iMessage user.");
}

export async function getMessagingSession(identity: string): Promise<MessagingSession | null> {
  const result = await db().from("messaging_sessions").select("*").eq("identity", identity).maybeSingle();
  if (result.error) throw new Error("Could not load messaging context.");
  return result.data as MessagingSession | null;
}

export async function saveMessagingSession(identity: string, values: Partial<Omit<MessagingSession, "identity">>): Promise<void> {
  const result = await db().from("messaging_sessions").upsert({ identity, ...values, updated_at: new Date().toISOString() }, { onConflict: "identity" });
  if (result.error) throw new Error("Could not save messaging context.");
}

const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const MAX_PHOTO_BYTES = 8_000_000;

function actualImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && /^(?:hei[cf]|heix|hevc|hevx|mif1|msf1)$/.test(bytes.subarray(8, 12).toString("ascii"))) return "image/heic";
  return null;
}

function extensionFor(mime: string): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heic" } as Record<string, string>)[mime] || "image";
}

export async function uploadSellerPhotos(userId: string, attachments: MessagingAttachment[], existing: SellerPhoto[]): Promise<SellerPhoto[]> {
  const seen = new Set(existing.map(photo => photo.id));
  const incoming = attachments.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, Math.max(0, 6 - existing.length));
  if (!incoming.length) return existing;
  const client = db();
  const added: SellerPhoto[] = [];
  try {
    for (const photo of incoming) {
      const declaredMime = photo.mimeType?.toLowerCase();
      if (!declaredMime || !PHOTO_MIMES.has(declaredMime)) throw new Error("Send me a JPEG, PNG, WebP, GIF, HEIC, or HEIF photo.");
      if (photo.size !== undefined && photo.size > MAX_PHOTO_BYTES) throw new Error("That photo is too big. Keep each one under 8 MB.");
      const bytes = await photo.read();
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error("That photo is too big. Keep each one under 8 MB.");
      const detectedMime = actualImageMime(bytes);
      if (!detectedMime || (declaredMime !== detectedMime && !(declaredMime === "image/heif" && detectedMime === "image/heic"))) {
        throw new Error("That attachment doesn't look like a usable image.");
      }
      const path = `${userId}/imessage-drafts/${crypto.randomUUID()}.${extensionFor(declaredMime)}`;
      const uploaded = await client.storage.from("listing-images").upload(path, bytes, { contentType: declaredMime, upsert: false });
      if (uploaded.error) throw new Error("I couldn't save that photo. Try sending it again.");
      added.push({ id: photo.id, path, url: client.storage.from("listing-images").getPublicUrl(path).data.publicUrl });
    }
    return [...existing, ...added];
  } catch (error) {
    if (added.length) await client.storage.from("listing-images").remove(added.map(photo => photo.path));
    throw error;
  }
}

export async function deleteSellerDraftPhotos(draft: SellerDraft | null | undefined): Promise<void> {
  const paths = draft?.photos.map(photo => photo.path).filter(Boolean) || [];
  if (paths.length) await db().storage.from("listing-images").remove(paths);
}

export async function createListingFromDraft(userId: string, draft: SellerDraft, listingId?: string): Promise<{ id: string }> {
  if (missingDraftField(draft)) throw new Error("That listing still needs a few details.");
  const client = db();
  const existing = await client.from("listings").select("id").eq("seller_id", userId).eq("status", "active").contains("image_urls", draft.photos.map(photo => photo.url)).maybeSingle();
  if (existing.data) return existing.data;
  if (existing.error) throw new Error("I couldn't verify that listing yet. Your draft is still here.");
  const created = await client.from("listings").insert({
    ...(listingId ? { id: listingId } : {}),
    seller_id: userId,
    title: draft.title,
    description: listingDescription(draft),
    price_cents: draft.priceCents,
    condition: draft.condition,
    city: draft.city,
    image_urls: draft.photos.map(photo => photo.url),
    status: "active",
  }).select("id").single();
  if (created.error) throw new Error("I couldn't put that listing up yet. Your draft is still here.");
  return created.data;
}

export async function activeListingsForSeller(userId: string): Promise<Listing[]> {
  const result = await db().from("listings").select("*").eq("seller_id", userId).eq("status", "active").order("created_at", { ascending: false }).limit(20);
  if (result.error) throw new Error("I couldn't load your listings right now.");
  return (result.data || []) as Listing[];
}

export async function updateOwnedListing(userId: string, listingId: string, values: { status: "sold" | "removed" } | { price_cents: number }): Promise<void> {
  const result = await db().from("listings").update(values).eq("id", listingId).eq("seller_id", userId).eq("status", "active").select("id").maybeSingle();
  if (result.error || !result.data) throw new Error("I couldn't update that active listing.");
}

export async function claimInboundEvent(messageId: string, spaceId: string, identity: string): Promise<boolean> {
  const result = await db().from("photon_message_events").insert({
    provider_message_id: messageId,
    photon_space_id: spaceId,
    direction: "inbound",
    event_kind: "user_message",
    normalized_identity: identity,
  });
  if (!result.error) return true;
  if (result.error.code === "23505") return false;
  throw new Error("Could not claim Photon message.");
}

export async function completePhotonEvent(messageId: string, error?: string): Promise<void> {
  await db().from("photon_message_events").update({
    status: error ? "failed" : "completed",
    error: error || null,
    completed_at: new Date().toISOString(),
  }).eq("provider_message_id", messageId);
}

export async function recordOutboundEvent(input: { messageId: string; spaceId: string; identity: string; kind: "dibs_reply" | "dibs_relay" | "dibs_attachment" }): Promise<void> {
  const result = await db().from("photon_message_events").upsert({
    provider_message_id: input.messageId,
    photon_space_id: input.spaceId,
    direction: "outbound",
    event_kind: input.kind,
    normalized_identity: input.identity,
    status: "completed",
    completed_at: new Date().toISOString(),
  }, { onConflict: "provider_message_id", ignoreDuplicates: true });
  if (result.error) throw new Error("Could not record outbound Photon message.");
}

export async function conversationDetails(id: string) {
  const result = await db().from("conversations").select("id,listing_id,buyer_id,seller_id,listing:listings(id,title,image_urls,status),buyer:users!buyer_id(id,name,imessage_address),seller:users!seller_id(id,name,imessage_address)").eq("id", id).maybeSingle();
  if (result.error) throw new Error("Could not load conversation.");
  return result.data as unknown as (ConversationRecord & {
    listing: { id: string; title: string; image_urls: string[]; status: string };
    buyer: { id: string; name: string; imessage_address: string | null };
    seller: { id: string; name: string; imessage_address: string | null };
  }) | null;
}

export async function listingForMessaging(id: string) {
  const result = await db().from("listings").select("*,seller:users!seller_id(id,name,imessage_address)").eq("id", id).maybeSingle();
  if (result.error) throw new Error("Could not load listing.");
  return result.data as { id: string; seller_id: string; title: string; image_urls: string[]; status: string; seller: { id: string; name: string; imessage_address: string | null } } | null;
}

export async function conversationsForUser(userId: string) {
  const result = await db().from("conversations").select("id,buyer_id,seller_id,listing:listings(title)").or(`buyer_id.eq.${userId},seller_id.eq.${userId}`).order("created_at", { ascending: false }).limit(10);
  if (result.error) throw new Error("Could not load conversations.");
  return (result.data || []) as unknown as Array<ConversationRecord & { listing: { title: string } }>;
}

export async function getOrCreateConversation(listingId: string, buyerId: string): Promise<ConversationRecord> {
  const client = db();
  const listing = await client.from("listings").select("id,seller_id,status").eq("id", listingId).maybeSingle();
  if (!listing.data || listing.data.status !== "active") throw new Error("Listing is unavailable.");
  if (listing.data.seller_id === buyerId) throw new Error("You cannot message yourself.");
  const existing = await client.from("conversations").select("id,listing_id,buyer_id,seller_id").eq("listing_id", listingId).eq("buyer_id", buyerId).maybeSingle();
  if (existing.data) return existing.data as ConversationRecord;
  const created = await client.from("conversations").insert({ listing_id: listingId, buyer_id: buyerId, seller_id: listing.data.seller_id }).select("id,listing_id,buyer_id,seller_id").single();
  if (created.error) {
    const raced = await client.from("conversations").select("id,listing_id,buyer_id,seller_id").eq("listing_id", listingId).eq("buyer_id", buyerId).maybeSingle();
    if (raced.data) return raced.data as ConversationRecord;
    throw new Error("Could not start conversation.");
  }
  return created.data as ConversationRecord;
}

export async function authorizedConversation(id: string, userId: string): Promise<ConversationRecord | null> {
  const result = await db().from("conversations").select("id,listing_id,buyer_id,seller_id").eq("id", id).maybeSingle();
  const conversation = result.data as ConversationRecord | null;
  return conversation && [conversation.buyer_id, conversation.seller_id].includes(userId) ? conversation : null;
}

export async function persistParticipantMessage(input: {
  conversation: ConversationRecord;
  senderId: string;
  body: string;
  providerMessageId?: string;
}) {
  const role = input.senderId === input.conversation.buyer_id ? "buyer" : input.senderId === input.conversation.seller_id ? "seller" : null;
  if (!role) throw new Error("Sender is not part of this conversation.");
  const created = await db().from("messages").insert({
    conversation_id: input.conversation.id,
    sender_id: input.senderId,
    body: input.body,
    message_kind: "participant",
    participant_role: role,
    transport_direction: input.providerMessageId ? "inbound" : null,
    provider_message_id: input.providerMessageId || null,
  }).select("id").single();
  if (created.error) throw new Error("Could not save message.");
  return created.data;
}

export async function persistDibsMessage(input: {
  conversationId: string;
  body: string;
  kind: "dibs_system" | "dibs_outbound";
  inReplyToMessageId?: string;
  providerMessageId?: string;
}) {
  const created = await db().from("messages").insert({
    conversation_id: input.conversationId,
    sender_id: null,
    body: input.body,
    message_kind: input.kind,
    participant_role: null,
    transport_direction: input.kind === "dibs_outbound" ? "outbound" : null,
    provider_message_id: input.providerMessageId || null,
    in_reply_to_message_id: input.inReplyToMessageId || null,
  }).select("id").single();
  if (created.error) throw new Error("Could not save Dibs message.");
  return created.data;
}