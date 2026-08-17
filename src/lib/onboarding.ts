import { db } from "./db";
import { recordProductEvent } from "./analytics";
import { saveMessagingSession } from "./marketplace";

export const ALPHA_FIRST_MESSAGE = "yo, i'm Dibs. i'm helping people buy and sell stuff around Miami. you looking to buy, sell, or just check it out?";

export type OnboardingState = "pending" | "sending" | "sent" | "replied" | "failed";
export type AlphaOnboarding = {
  id: string;
  phone_e164: string;
  user_id: string;
  state: OnboardingState;
  source: string;
  visitor_id: string | null;
  attribution_token: string | null;
  originating_listing_id: string | null;
  photon_space_id: string | null;
  provider_message_id: string | null;
  submission_count: number;
  attempt_count: number;
  attempted_at: string | null;
  sent_at: string | null;
  replied_at: string | null;
};

type Submission = {
  phone: string;
  source: string;
  visitorId: string | null;
  attributionId: string | null;
  originatingListingId: string | null;
};

function rpcRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] || null : data;
}

export async function submitAlphaOnboarding(input: Submission): Promise<AlphaOnboarding> {
  const result = await db().rpc("request_alpha_onboarding", {
    requested_phone: input.phone,
    requested_source: input.source,
    requested_visitor_id: input.visitorId,
    requested_attribution_token: input.attributionId,
    requested_originating_listing_id: input.originatingListingId,
  });
  const onboarding = rpcRow(result.data as AlphaOnboarding | AlphaOnboarding[] | null);
  if (result.error || !onboarding) throw new Error("Could not accept onboarding.");
  await recordProductEvent({ eventName: "alpha_onboarding_submitted", userId: onboarding.user_id, listingId: onboarding.originating_listing_id, visitorId: onboarding.visitor_id, attributionToken: onboarding.attribution_token, source: onboarding.source, metadata: { city: "Miami", cohort: "miami_alpha" } })
    .catch(error => console.warn("Could not record onboarding submission", error));
  if (onboarding.submission_count === 1) {
    await recordProductEvent({
      eventName: "alpha_onboarding_accepted",
      userId: onboarding.user_id,
      listingId: onboarding.originating_listing_id,
      visitorId: onboarding.visitor_id,
      attributionToken: onboarding.attribution_token,
      source: onboarding.source,
      metadata: { city: "Miami", cohort: "miami_alpha" },
    }).catch(error => console.warn("Could not record onboarding event", error));
  }
  return onboarding;
}

export async function claimAlphaOnboarding(): Promise<AlphaOnboarding | null> {
  const result = await db().rpc("claim_alpha_onboarding");
  if (result.error) throw new Error("Could not claim onboarding.");
  return rpcRow(result.data as AlphaOnboarding | AlphaOnboarding[] | null);
}

export async function markAlphaOnboardingSent(onboarding: AlphaOnboarding, spaceId: string, providerMessageId: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await db().from("alpha_onboardings").update({
    state: "sent", photon_space_id: spaceId, provider_message_id: providerMessageId,
    sent_at: now, completed_at: now, failure_class: null,
  }).eq("id", onboarding.id).eq("state", "sending").select("id").maybeSingle();
  if (result.error || !result.data) throw new Error("Could not confirm onboarding delivery.");
  await recordProductEvent({ eventName: "alpha_first_message_sent", userId: onboarding.user_id, listingId: onboarding.originating_listing_id, visitorId: onboarding.visitor_id, attributionToken: onboarding.attribution_token, source: onboarding.source, metadata: { channel: "imessage" } })
    .catch(error => console.warn("Could not record onboarding send event", error));
}

export async function markAlphaOnboardingFailure(id: string, failureClass: "photon_unavailable" | "delivery_unknown", retryable: boolean, spaceId?: string): Promise<void> {
  const result = await db().from("alpha_onboardings").update({
    state: retryable ? "failed" : "sending",
    failure_class: failureClass,
    retryable,
    ...(retryable ? { next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() } : {}),
    photon_space_id: spaceId || null,
    completed_at: retryable ? new Date().toISOString() : null,
  }).eq("id", id).eq("state", "sending");
  if (result.error) throw new Error("Could not record onboarding failure.");
}

export type OnboardingTransport = {
  createSpace(phone: string): Promise<{ id: string; send(text: string): Promise<{ id?: string } | undefined> }>;
  recordSent(messageId: string, spaceId: string, phone: string): Promise<void>;
};

export async function processNextAlphaOnboarding(transport: OnboardingTransport): Promise<boolean> {
  const onboarding = await claimAlphaOnboarding();
  if (!onboarding) return false;
  await recordProductEvent({ eventName: "alpha_first_message_attempted", userId: onboarding.user_id, listingId: onboarding.originating_listing_id, visitorId: onboarding.visitor_id, attributionToken: onboarding.attribution_token, source: onboarding.source, metadata: { attempt: onboarding.attempt_count } })
    .catch(error => console.warn("Could not record onboarding attempt", error));
  let space: Awaited<ReturnType<OnboardingTransport["createSpace"]>>;
  try {
    space = await transport.createSpace(onboarding.phone_e164);
    await saveMessagingSession(onboarding.phone_e164, { user_id: onboarding.user_id, photon_space_id: space.id });
  } catch {
    await markAlphaOnboardingFailure(onboarding.id, "photon_unavailable", true);
    return true;
  }
  try {
    const sent = await space.send(ALPHA_FIRST_MESSAGE);
    if (!sent?.id) throw new Error("Photon did not confirm delivery.");
    await markAlphaOnboardingSent(onboarding, space.id, sent.id);
    await transport.recordSent(sent.id, space.id, onboarding.phone_e164)
      .catch(error => console.warn("Could not record outbound Photon event", error));
  } catch {
    await markAlphaOnboardingFailure(onboarding.id, "delivery_unknown", false, space.id);
  }
  return true;
}

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