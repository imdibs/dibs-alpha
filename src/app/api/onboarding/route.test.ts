import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(), listing: vi.fn(), rateLimited: vi.fn(), recipientHash: vi.fn(() => "a".repeat(64)),
  RecipientLimitError: class extends Error {},
  RequestIdConflictError: class extends Error {},
}));
vi.mock("@/lib/onboarding", () => ({
  submitAlphaOnboarding: mocks.submit,
  OnboardingRecipientRateLimitError: mocks.RecipientLimitError,
  OnboardingRequestIdConflictError: mocks.RequestIdConflictError,
}));
vi.mock("@/lib/public-listings", () => ({ getPublicListing: mocks.listing }));
vi.mock("@/lib/onboarding-rate-limit", () => ({ onboardingRateLimited: mocks.rateLimited, onboardingRecipientKeyHash: mocks.recipientHash }));
import { OPTIONS, POST } from "./route";

const visitorId = "550e8400-e29b-41d4-a716-446655440000";
const attributionId = "550e8400-e29b-41d4-a716-446655440001";
const token = "7xK92pAb_Cde";
const requestId = "550e8400-e29b-41d4-a716-446655440010";
function request(body: unknown, ip = "203.0.113.1", origin?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
  if (origin) headers.origin = origin;
  const withRequestId = typeof body === "object" && body !== null ? { requestId, ...body } : body;
  return new Request("https://app.dibs.chat/api/onboarding", { method: "POST", headers, body: JSON.stringify(withRequestId) });
}

describe("CORS /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.rateLimited.mockResolvedValue(false);
    mocks.submit.mockResolvedValue({ id: requestId, state: "pending" });
  });

  it.each([
    "http://127.0.0.1:4200",
    "http://localhost:4200",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
  ])("accepts preflight from %s", origin => {
    const response = OPTIONS(new Request("https://app.dibs.chat/api/onboarding", { method: "OPTIONS", headers: { origin } }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type");
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it.each([
    "http://127.0.0.1:4200",
    "http://localhost:4200",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
  ])("adds the approved origin to POST responses for %s", async origin => {
    const response = await POST(request({ phone: "305-555-0123", source: "website" }, "203.0.113.10", origin));
    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("allows an origin configured through DIBS_WEB_ORIGINS", async () => {
    const origin = "https://web.example";
    vi.stubEnv("DIBS_WEB_ORIGINS", origin);
    const preflight = OPTIONS(new Request("https://app.dibs.chat/api/onboarding", { method: "OPTIONS", headers: { origin } }));
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("allows multiple comma-separated configured origins", async () => {
    vi.stubEnv("DIBS_WEB_ORIGINS", "https://web-one.example,https://web-two.example");
    for (const origin of ["https://web-one.example", "https://web-two.example"]) {
      const preflight = OPTIONS(new Request("https://app.dibs.chat/api/onboarding", { method: "OPTIONS", headers: { origin } }));
      const response = await POST(request({ phone: "305-555-0123", source: "website" }, origin, origin));
      expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("trims whitespace around configured origins", () => {
    const origin = "https://web.example";
    vi.stubEnv("DIBS_WEB_ORIGINS", `  ${origin}  `);
    const preflight = OPTIONS(new Request("https://app.dibs.chat/api/onboarding", { method: "OPTIONS", headers: { origin } }));
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("does not allow an unapproved origin", async () => {
    vi.stubEnv("DIBS_WEB_ORIGINS", "https://approved.example,*");
    const origin = "https://unapproved.example";
    const preflight = OPTIONS(new Request("https://app.dibs.chat/api/onboarding", { method: "OPTIONS", headers: { origin } }));
    const response = await POST(request({ phone: "305-555-0123", source: "website" }, "203.0.113.11", origin));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(preflight.headers.has("access-control-allow-credentials")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });
});

describe("POST /api/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.rateLimited.mockResolvedValue(false);
    mocks.listing.mockResolvedValue({ id: "listing-1" });
    mocks.submit.mockResolvedValue({ id: requestId, state: "pending" });
  });

  it.each(["+1 305 555 1234", "(305) 555-1234", "305-555-1234"])("accepts and canonicalizes %s", async phone => {
    const response = await POST(request({ phone, source: "website", visitorId, attributionId, originatingListing: token }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, initiated: false, requestId });
    expect(mocks.submit).toHaveBeenCalledWith({ requestId, phone: "+13055551234", source: "website", recipientKeyHash: "a".repeat(64), visitorId, attributionId, originatingListingId: "listing-1" });
  });

  it.each(["+919769760891", "+14155552671", "+447911123456"])("accepts canonical international identity %s", async phone => {
    const response = await POST(request({ phone, source: "website" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, initiated: false, requestId });
    expect(mocks.submit).toHaveBeenCalledWith({
      requestId, phone, recipientKeyHash: "a".repeat(64),
      source: "website",
      visitorId: null,
      attributionId: null,
      originatingListingId: null,
    });
  });

  it("reports initiated only for authoritative sent state and never dispatches caller content", async () => {
    mocks.submit.mockResolvedValue({ id: requestId, state: "sent" });
    const response = await POST(request({ phone: "3055551234", source: "referral" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, initiated: true, requestId });
  });

  it("preserves durable idempotency handling for repeated equivalent submissions", async () => {
    mocks.submit.mockResolvedValueOnce({ id: requestId, state: "pending" }).mockResolvedValueOnce({ id: requestId, state: "sent" });
    const first = await POST(request({ phone: "(305) 555-0123", source: "website" }, "203.0.113.20"));
    const repeated = await POST(request({ phone: "+1 305 555 0123", source: "website" }, "203.0.113.20"));
    expect(first.status).toBe(202);
    expect(repeated.status).toBe(200);
    expect(mocks.submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ phone: "+13055550123" }));
    expect(mocks.submit).toHaveBeenNthCalledWith(2, expect.objectContaining({ phone: "+13055550123" }));
  });

  it.each([
    { phone: "bad", source: "direct" },
    { phone: "+44 7911 123456", source: "direct" },
    { phone: "++447911123456", source: "direct" },
    { phone: "+-447911123456", source: "direct" },
    { phone: "+01234567890", source: "direct" },
    { phone: "+1234567890123456", source: "direct" },
    { phone: "+11235551234", source: "direct" },
    { phone: "3055551234", source: "spam" },
    { phone: "3055551234", source: "direct", userId: "user-1" },
    { phone: "3055551234", source: "direct", recipient: "+13055559999" },
    { phone: "3055551234", source: "direct", message: "anything" },
    { phone: "3055551234", source: "direct", photonOperation: "send" },
    { phone: "3055551234", source: "direct", visitorId: "not-a-token" },
  ])("rejects malformed or privileged payload %#", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([undefined, "not-a-uuid"])("rejects missing or invalid request IDs: %s", async invalidRequestId => {
    expect((await POST(request({ phone: "3055551234", source: "direct", requestId: invalidRequestId }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("maps the durable per-recipient limit to a controlled 429", async () => {
    mocks.submit.mockRejectedValueOnce(new mocks.RecipientLimitError());
    const response = await POST(request({ phone: "3055551234", source: "direct" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests for this phone number. Try again later." });
  });

  it("maps request ID payload conflicts to a controlled 409", async () => {
    mocks.submit.mockRejectedValueOnce(new mocks.RequestIdConflictError());
    const response = await POST(request({ phone: "3055551234", source: "direct" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Request ID was already used for different onboarding details." });
  });

  it("rejects missing originating listings and controlled persistence failures", async () => {
    mocks.listing.mockResolvedValueOnce(null);
    expect((await POST(request({ phone: "3055551234", source: "direct", originatingListing: token }))).status).toBe(400);
    mocks.submit.mockRejectedValueOnce(new Error("secret database details"));
    const response = await POST(request({ phone: "3055551234", source: "direct" }, "203.0.113.2"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Could not accept onboarding right now." });
  });

  it("rejects declared oversized bodies and rate limits the public caller", async () => {
    const oversized = request({ phone: "3055551234", source: "direct" });
    oversized.headers.set("content-length", "2049");
    expect((await POST(oversized)).status).toBe(413);
    const undeclared = new Request("https://app.dibs.chat/api/onboarding", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.3" }, body: JSON.stringify({ phone: "3055551234", source: "direct", padding: "x".repeat(2100) }) });
    expect((await POST(undeclared)).status).toBe(413);
    for (let index = 0; index < 5; index += 1) expect((await POST(request({ phone: "3055551234", source: "direct" }, "198.51.100.4"))).status).toBe(202);
    mocks.rateLimited.mockResolvedValueOnce(true);
    expect((await POST(request({ phone: "3055551234", source: "direct" }, "198.51.100.4"))).status).toBe(429);
  });
});