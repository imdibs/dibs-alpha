import { db } from "./db";
import { recordProductEvent } from "./analytics";
import { getMessagingSession, saveMessagingSession } from "./marketplace";

export const ALPHA_FIRST_MESSAGE = "yo, i'm Dibs. i'm helping people buy and sell stuff around Miami. you looking to buy, sell, or just check it out?";

export type OnboardingMessageRequestState = "pending" | "preparing" | "sending" | "sent" | "failed";
export type OnboardingMessageRequest = {
  id: string;
  user_id: string;
  alpha_onboarding_id: string;
  phone_e164: string;
  state: OnboardingMessageRequestState;
  source: string;
  visitor_id: string | null;
  attribution_token: string | null;
  originating_listing_id: string | null;
  photon_space_id: string | null;
  provider_message_id: string | null;
  attempt_count: number;
  claim_token: string | null;
  created_user: boolean;
  created_alpha_onboarding: boolean;
  retryable: boolean;
  failure_class: string | null;
};

type Submission = {
  requestId: string;
  phone: string;
  source: string;
  recipientKeyHash: string;
  visitorId: string | null;
  attributionId: string | null;
  originatingListingId: string | null;
};

export class OnboardingRecipientRateLimitError extends Error {}
export class OnboardingRequestIdConflictError extends Error {}

function rpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] || null : data;
}

function eventContext(request: OnboardingMessageRequest) {
  return {
    userId: request.user_id,
    listingId: request.originating_listing_id,
    visitorId: request.visitor_id,
    attributionToken: request.attribution_token,
    source: request.source,
  };
}

export async function submitAlphaOnboarding(input: Submission): Promise<OnboardingMessageRequest> {
  const result = await db().rpc("enqueue_onboarding_message_request", {
    requested_id: input.requestId,
    requested_phone: input.phone,
    requested_source: input.source,
    requested_recipient_key_hash: input.recipientKeyHash,
    requested_visitor_id: input.visitorId,
    requested_attribution_token: input.attributionId,
    requested_originating_listing_id: input.originatingListingId,
  });
  if (result.error?.message?.includes("onboarding_recipient_rate_limited")) throw new OnboardingRecipientRateLimitError();
  if (result.error?.message?.includes("onboarding_request_id_conflict")) throw new OnboardingRequestIdConflictError();
  const request = rpcRow(result.data as OnboardingMessageRequest | OnboardingMessageRequest[] | null);
  if (result.error || !request) throw new Error("Could not accept onboarding.");

  const analyticsClaim = await db().rpc("claim_onboarding_message_request_analytics", { requested_id: request.id });
  if (!analyticsClaim.error && analyticsClaim.data === true) {
    await recordProductEvent({
      eventName: "onboarding_message_requested", ...eventContext(request),
      metadata: { channel: "imessage", request_id: request.id },
    }).catch(error => console.warn("Could not record onboarding message request", error));
    if (request.created_alpha_onboarding) {
      await recordProductEvent({
        eventName: "alpha_onboarding_accepted", ...eventContext(request),
        metadata: { city: "Miami", cohort: "miami_alpha" },
      }).catch(error => console.warn("Could not record onboarding event", error));
    }
  }
  return request;
}

export async function claimAlphaOnboarding(): Promise<OnboardingMessageRequest | null> {
  const result = await db().rpc("claim_onboarding_message_request");
  if (result.error) throw new Error("Could not claim onboarding message request.");
  return rpcRow(result.data as OnboardingMessageRequest | OnboardingMessageRequest[] | null);
}

export async function beginAlphaOnboardingDispatch(request: OnboardingMessageRequest, spaceId: string): Promise<OnboardingMessageRequest> {
  if (!request.claim_token) throw new Error("Claim token missing.");
  const result = await db().rpc("begin_onboarding_message_dispatch", {
    requested_id: request.id, requested_claim_token: request.claim_token, requested_photon_space_id: spaceId,
  });
  const sending = rpcRow(result.data as OnboardingMessageRequest | OnboardingMessageRequest[] | null);
  if (result.error || !sending) throw new Error("Could not begin onboarding delivery.");
  return sending;
}

export async function markAlphaOnboardingSent(request: OnboardingMessageRequest, providerMessageId: string): Promise<void> {
  if (!request.claim_token) throw new Error("Claim token missing.");
  const result = await db().rpc("complete_onboarding_message_request", {
    requested_id: request.id, requested_claim_token: request.claim_token,
    requested_provider_message_id: providerMessageId, requested_sent_at: new Date().toISOString(),
  });
  if (result.error || !rpcRow(result.data as OnboardingMessageRequest | OnboardingMessageRequest[] | null)) throw new Error("Could not confirm onboarding delivery.");
  await recordProductEvent({
    eventName: "onboarding_message_sent", ...eventContext(request),
    metadata: { channel: "imessage", request_id: request.id },
  }).catch(error => console.warn("Could not record onboarding send event", error));
}

export async function markAlphaOnboardingFailure(
  request: OnboardingMessageRequest,
  failureClass: "photon_unavailable" | "persistence_error" | "delivery_unknown",
  retryable: boolean,
): Promise<void> {
  if (!request.claim_token) throw new Error("Claim token missing.");
  const result = await db().rpc("fail_onboarding_message_request", {
    requested_id: request.id, requested_claim_token: request.claim_token,
    requested_failure_class: failureClass, requested_retryable: retryable,
    requested_next_attempt_at: retryable ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
  });
  if (result.error || !rpcRow(result.data as OnboardingMessageRequest | OnboardingMessageRequest[] | null)) throw new Error("Could not record onboarding failure.");
}

export type OnboardingTransport = {
  resolveSpace(phone: string, existingSpaceId: string | null): Promise<{ id: string; send(text: string): Promise<{ id?: string } | undefined> }>;
  recordSent(messageId: string, spaceId: string, phone: string): Promise<void>;
};

export async function processNextAlphaOnboarding(transport: OnboardingTransport): Promise<boolean> {
  const request = await claimAlphaOnboarding();
  if (!request) return false;
  await recordProductEvent({
    eventName: "onboarding_message_attempted", ...eventContext(request),
    metadata: { attempt: request.attempt_count, request_id: request.id },
  }).catch(error => console.warn("Could not record onboarding attempt", error));

  let space: Awaited<ReturnType<OnboardingTransport["resolveSpace"]>>;
  try {
    const session = await getMessagingSession(request.phone_e164);
    if (session?.user_id && session.user_id !== request.user_id) throw new Error("Messaging identity belongs to another user.");
    space = await transport.resolveSpace(request.phone_e164, session?.photon_space_id || null);
    // The partial upsert preserves existing marketplace context and drafts;
    // AI history remains attached to this unchanged user ID.
    await saveMessagingSession(request.phone_e164, { user_id: request.user_id, photon_space_id: space.id });
  } catch {
    await markAlphaOnboardingFailure(request, "photon_unavailable", true);
    return true;
  }

  let sending: OnboardingMessageRequest;
  try {
    sending = await beginAlphaOnboardingDispatch(request, space.id);
  } catch {
    // The transition may have committed even if its response was lost. The RPC
    // is idempotent for this claim token, so reconcile once before declaring a
    // retryable preparation failure. No provider send occurs before this.
    try {
      sending = await beginAlphaOnboardingDispatch(request, space.id);
    } catch {
      await markAlphaOnboardingFailure(request, "persistence_error", true);
      return true;
    }
  }

  try {
    const sent = await space.send(ALPHA_FIRST_MESSAGE);
    if (!sent?.id) throw new Error("Photon did not confirm delivery.");
    await markAlphaOnboardingSent(sending, sent.id);
    await transport.recordSent(sent.id, space.id, request.phone_e164)
      .catch(error => console.warn("Could not record outbound Photon event", error));
  } catch {
    await markAlphaOnboardingFailure(sending, "delivery_unknown", false);
  }
  return true;
}

// Inbound routing still keys users by users.imessage_address. This advances
// only the one historical first-onboarding lifecycle.
export async function markAlphaOnboardingReplied(phone: string, spaceId: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await db().from("alpha_onboardings").update({ state: "replied", replied_at: now, completed_at: now, photon_space_id: spaceId, failure_class: null })
    .eq("phone_e164", phone).in("state", ["sent", "sending"]).select("user_id,source,visitor_id,attribution_token,originating_listing_id").maybeSingle();
  if (result.error || !result.data) return;
  await db().from("users").update({ activated_at: now }).eq("id", result.data.user_id).is("activated_at", null);
  const event = { userId: result.data.user_id, listingId: result.data.originating_listing_id, visitorId: result.data.visitor_id, attributionToken: result.data.attribution_token, source: result.data.source, metadata: { channel: "imessage" } };
  await recordProductEvent({ eventName: "alpha_user_replied", ...event }).catch(error => console.warn("Could not record onboarding reply", error));
  await recordProductEvent({ eventName: "user_activated", ...event }).catch(error => console.warn("Could not record activation", error));
}