import { randomUUID } from "node:crypto";
import { db } from "./db";
import { displayListingTitle } from "./messaging";
import { createDibsMarketplaceGroup, type MarketplaceGroupProvider } from "./marketplace-group";

export type MarketplaceConnection = {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  provider_space_id: string | null;
  provider_line: string | null;
  provider_group_type: "group" | null;
  buyer_provider_identity: string | null;
  seller_provider_identity: string | null;
  connection_status: string;
  provider_creation_key: string | null;
  provider_introduction_message_id: string | null;
  listing: { id: string; title: string; price_cents: number; status: string };
  buyer: { id: string; imessage_address: string | null };
  seller: { id: string; imessage_address: string | null };
};

export type MarketplaceConnectionRepository = {
  getOrCreate(listingId: string, buyerId: string): Promise<MarketplaceConnection>;
  reserveGroupCreation(conversationId: string, creationKey: string, buyerIdentity: string, sellerIdentity: string): Promise<boolean>;
  saveProviderGroup(conversationId: string, input: { providerSpaceId: string; providerLine: string }): Promise<void>;
  reserveIntroduction(conversationId: string): Promise<boolean>;
  markConnected(conversationId: string, providerMessageId?: string): Promise<void>;
  markReconciliationRequired(conversationId: string): Promise<void>;
};

const CONNECTION_SELECT = "id,listing_id,buyer_id,seller_id,provider_space_id,provider_line,provider_group_type,buyer_provider_identity,seller_provider_identity,connection_status,provider_creation_key,provider_introduction_message_id,listing:listings(id,title,price_cents,status),buyer:users!buyer_id(id,imessage_address),seller:users!seller_id(id,imessage_address)";

export const marketplaceConnectionRepository: MarketplaceConnectionRepository = {
  async getOrCreate(listingId, buyerId) {
    const client = db();
    const listing = await client.from("listings").select("id,seller_id,status").eq("id", listingId).maybeSingle();
    if (listing.error || !listing.data) throw new Error("Listing does not exist.");
    if (listing.data.status !== "active") throw new Error("Listing is unavailable.");
    if (listing.data.seller_id === buyerId) throw new Error("You cannot connect to your own listing.");
    let result = await client.from("conversations").select(CONNECTION_SELECT).eq("listing_id", listingId).eq("buyer_id", buyerId).maybeSingle();
    if (!result.data) {
      const created = await client.from("conversations").insert({ listing_id: listingId, buyer_id: buyerId, seller_id: listing.data.seller_id, connection_status: "group_pending" }).select(CONNECTION_SELECT).single();
      if (!created.error) result = created;
      else result = await client.from("conversations").select(CONNECTION_SELECT).eq("listing_id", listingId).eq("buyer_id", buyerId).maybeSingle();
    }
    if (result.error || !result.data) throw new Error("Could not prepare marketplace conversation.");
    return result.data as unknown as MarketplaceConnection;
  },
  async reserveGroupCreation(conversationId, creationKey, buyerIdentity, sellerIdentity) {
    const result = await db().from("conversations").update({
      connection_status: "group_creating", provider_creation_key: creationKey,
      buyer_provider_identity: buyerIdentity, seller_provider_identity: sellerIdentity, updated_at: new Date().toISOString(),
    }).eq("id", conversationId).in("connection_status", ["relay", "group_pending", "failed"]).is("provider_space_id", null).select("id").maybeSingle();
    if (result.error) throw new Error("Could not reserve group creation.");
    return Boolean(result.data);
  },
  async saveProviderGroup(conversationId, input) {
    const result = await db().from("conversations").update({
      provider_space_id: input.providerSpaceId, provider_line: input.providerLine, provider_group_type: "group",
      connection_status: "group_created", updated_at: new Date().toISOString(),
    }).eq("id", conversationId).eq("connection_status", "group_creating").select("id").single();
    if (result.error) throw new Error("Provider group requires reconciliation before retrying.");
  },
  async reserveIntroduction(conversationId) {
    const result = await db().from("conversations").update({ connection_status: "introduction_sending", updated_at: new Date().toISOString() })
      .eq("id", conversationId).eq("connection_status", "group_created").select("id").maybeSingle();
    if (result.error) throw new Error("Could not reserve the group introduction.");
    return Boolean(result.data);
  },
  async markConnected(conversationId, providerMessageId) {
    const result = await db().from("conversations").update({
      connection_status: "connected", provider_introduction_message_id: providerMessageId || null,
      connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", conversationId).eq("connection_status", "introduction_sending");
    if (result.error) throw new Error("Introduction delivery requires reconciliation before retrying.");
  },
  async markReconciliationRequired(conversationId) {
    await db().from("conversations").update({ connection_status: "reconciliation_required", updated_at: new Date().toISOString() }).eq("id", conversationId);
  },
};

export type ConnectBuyerToSellerDependencies = {
  repository?: MarketplaceConnectionRepository;
  provider: MarketplaceGroupProvider;
  configuredLine?: string;
};

export async function connectBuyerToSeller(
  trusted: { buyerId: string; selectedListingId: string },
  dependencies: ConnectBuyerToSellerDependencies,
): Promise<{ conversationId: string; providerSpaceId: string; providerLine: string; reused: boolean }> {
  const repository = dependencies.repository || marketplaceConnectionRepository;
  let conversation = await repository.getOrCreate(trusted.selectedListingId, trusted.buyerId);
  if (conversation.buyer_id !== trusted.buyerId || conversation.listing_id !== trusted.selectedListingId) throw new Error("Conversation context mismatch.");
  if (conversation.listing.status !== "active") throw new Error("Listing is unavailable.");
  if (conversation.buyer_id === conversation.seller_id) throw new Error("You cannot connect to your own listing.");
  const buyerIdentity = conversation.buyer.imessage_address;
  const sellerIdentity = conversation.seller.imessage_address;
  if (!buyerIdentity || !sellerIdentity) throw new Error("Both buyer and seller need verified iMessage identities.");
  if (conversation.connection_status === "connected" && conversation.provider_space_id && conversation.provider_line) {
    if (conversation.provider_line !== dependencies.configuredLine?.trim()) {
      throw new Error("The marketplace group belongs to a different provider line and requires reconciliation.");
    }
    return { conversationId: conversation.id, providerSpaceId: conversation.provider_space_id, providerLine: conversation.provider_line, reused: true };
  }
  if (["group_creating", "introduction_sending", "reconciliation_required"].includes(conversation.connection_status)) {
    throw new Error("This connection attempt requires provider reconciliation; no duplicate group was created.");
  }
  if (!conversation.provider_space_id) {
    const creationKey = randomUUID();
    const reserved = await repository.reserveGroupCreation(conversation.id, creationKey, buyerIdentity, sellerIdentity);
    if (!reserved) throw new Error("Another connection attempt is already in progress.");
    try {
      const group = await createDibsMarketplaceGroup({ buyerAddress: buyerIdentity, sellerAddress: sellerIdentity }, dependencies);
      await repository.saveProviderGroup(conversation.id, { providerSpaceId: group.providerSpaceId, providerLine: group.providerLine });
      conversation = { ...conversation, provider_space_id: group.providerSpaceId, provider_line: group.providerLine, provider_group_type: "group", connection_status: "group_created" };
    } catch (error) {
      await repository.markReconciliationRequired(conversation.id).catch(() => undefined);
      throw error;
    }
  }
  if (!conversation.provider_space_id || !conversation.provider_line) throw new Error("Marketplace group is unavailable.");
  const reservedIntroduction = await repository.reserveIntroduction(conversation.id);
  if (!reservedIntroduction) throw new Error("The group introduction is already being processed.");
  const introduction = `yo, connecting you two about the ${displayListingTitle(conversation.listing.title)} for $${(conversation.listing.price_cents / 100).toLocaleString("en-US")}. buyer's interested and seller's listing is still up. i'll stay here if either of you needs me.`;
  try {
    const space = await dependencies.provider.get(conversation.provider_space_id, { phone: conversation.provider_line });
    const sent = await space.send(introduction);
    await repository.markConnected(conversation.id, sent?.id);
  } catch (error) {
    await repository.markReconciliationRequired(conversation.id).catch(() => undefined);
    throw error;
  }
  return { conversationId: conversation.id, providerSpaceId: conversation.provider_space_id, providerLine: conversation.provider_line, reused: false };
}