import { PostHog } from "posthog-node";

export const POSTHOG_EVENT_PROPERTIES = {
  user_signed_up: ["source", "city", "onboarding_method"],
  onboarding_started: ["source", "onboarding_method"],
  onboarding_completed: ["source", "onboarding_method"],
  first_message_received: ["channel", "message_kind"],
  first_response_sent: ["channel", "message_kind"],
  listing_created: ["listing_id", "category", "condition", "city", "price_cents", "seller_or_buyer_role"],
  listing_updated: ["category", "condition", "city", "price_cents"],
  listing_removed: ["category", "removal_reason"],
  product_search: ["category", "city", "intent", "channel"],
  buy_request: ["category", "city", "channel"],
  sell_request: ["category", "city", "channel"],
  deal_started: ["category", "channel"],
  deal_completed: ["category", "channel"],
  message_received: ["channel", "message_kind", "direction"],
  message_sent: ["channel", "message_kind", "direction"],
  ai_response_generated: ["channel", "intent", "success"],
  message_delivery_failed: ["channel", "failure_type", "retryable"],
  relay_started: ["channel"],
  relay_message_sent: ["channel", "direction"],
  relay_completed: ["channel"],
  relay_failed: ["failure_type", "retryable"],
  followup_scheduled: ["kind", "stage"],
  followup_evaluated: ["kind", "stage", "decision"],
  followup_sent: ["kind", "stage"],
  followup_suppressed: ["kind", "stage", "decision"],
  followup_failed: ["kind", "stage", "failure_type", "retryable"],
  dibs_error: ["subsystem", "error_type", "retryable"],
} as const;

export type PostHogEventName = keyof typeof POSTHOG_EVENT_PROPERTIES;
type SafeValue = string | number | boolean | null | undefined;
export type PostHogEvent = {
  event: PostHogEventName;
  distinctId?: string | null;
  properties?: Record<string, SafeValue>;
};
type CaptureClient = Pick<PostHog, "capture">;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
const phonePattern = /(?:\+?\d[\d\s().-]{6,}\d)/;
let client: CaptureClient | null | undefined;

function configuredClient(): CaptureClient | null {
  if (client !== undefined) return client;
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  const host = process.env.POSTHOG_HOST?.trim();
  if (!apiKey || !host) return (client = null);
  try {
    client = new PostHog(apiKey, {
      host,
      flushAt: 1,
      flushInterval: 10_000,
      requestTimeout: 1_000,
      disableGeoip: true,
      privacyMode: true,
    });
  } catch {
    console.warn("PostHog analytics unavailable", { error_type: "initialization_failed" });
    client = null;
  }
  return client;
}

function safeString(value: string): boolean {
  return value.length <= 120 && !emailPattern.test(value) && !phonePattern.test(value) && !value.startsWith("data:");
}

export function sanitizePostHogProperties(event: PostHogEventName, properties: Record<string, SafeValue> = {}): Record<string, string | number | boolean | null> {
  const allowed = new Set<string>(POSTHOG_EVENT_PROPERTIES[event]);
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!allowed.has(key) || value === undefined) continue;
    if (typeof value === "string" && !safeString(value)) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    safe[key] = value;
  }
  return safe;
}

/** Queues an analytics event and returns immediately. It never flushes or awaits network I/O. */
export function capturePostHog(input: PostHogEvent): void {
  const posthog = configuredClient();
  if (!posthog) return;
  const distinctId = input.distinctId && uuidPattern.test(input.distinctId) ? input.distinctId.toLowerCase() : "dibs_anonymous";
  try {
    posthog.capture({
      distinctId,
      event: input.event,
      properties: { ...sanitizePostHogProperties(input.event, input.properties), $process_person_profile: false },
      disableGeoip: true,
    });
  } catch {
    console.warn("PostHog analytics unavailable", { event: input.event, error_type: "capture_failed" });
  }
}

export function captureDibsError(input: { distinctId?: string | null; subsystem: string; errorType: string; retryable: boolean }): void {
  const category = (value: string) => /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : "unknown";
  capturePostHog({ event: "dibs_error", distinctId: input.distinctId, properties: { subsystem: category(input.subsystem), error_type: category(input.errorType), retryable: input.retryable } });
}

export function setPostHogClientForTests(value: CaptureClient | null | undefined): void {
  if (process.env.NODE_ENV !== "test") return;
  client = value;
}