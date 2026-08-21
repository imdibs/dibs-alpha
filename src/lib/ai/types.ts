import type { Listing } from "../types";
import type { MessagingSession } from "../marketplace";
import type { SellerDraft } from "../seller-listing";
import type { OutboundPart } from "../messaging";

export type AiConfig = {
  model: string;
  apiKey: string;
  timeoutMs: number;
};

export type AiMessage = { role: "system" | "user" | "assistant"; content: string };
export type AiClient = { complete(messages: AiMessage[], schema?: Record<string, unknown>): Promise<string> };
export type AiHistoryTurn = { role: "user" | "assistant" | "tool"; body: string };
export type TrustedToolContext = {
  userId: string;
  normalizedIdentity: string;
  inboundMessageId: string;
  photonSpaceId: string;
  defaultCity: string;
  currentMessageText?: string;
};

export const TOOL_NAMES = [
  "updateUserProfile",
  "searchListings", "getListing", "getRecentSearchResults", "getSelectedListing",
  "getCurrentSellerDraft", "getOwnedListings", "getActiveConversation", "getRecentConversationHistory",
  "updateSellerDraft", "discardSellerDraft", "reviewSellerDraft", "publishListing", "sendListingShareLink", "declineListingShareLink",
  "updateOwnedListingPrice", "markOwnedListingSold", "removeOwnedListing",
  "connectBuyerToSeller",
] as const;
export type ToolName = typeof TOOL_NAMES[number];
export type ToolRequest = { name: ToolName; arguments: Record<string, unknown> };
export type ToolResult = { name: ToolName; ok: boolean; data?: unknown; error?: string };
export type AgentPlan = { tools: ToolRequest[]; responseHint: string };
export type AgentContext = {
  name: string | null;
  city: string | null;
  session: MessagingSession | null;
  history: AiHistoryTurn[];
  sellerDraft: SellerDraft | null;
  recentListings: Listing[];
  selectedListing: Listing | null;
};
export type AgentTurnResult = { text: string; parts?: OutboundPart[]; toolResults: ToolResult[] };