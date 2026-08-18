import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ db: () => ({ rpc }) }));
import { durableRateLimited } from "./rate-limit";

describe("durable rate limiting", () => {
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

  it("stores only a scoped HMAC of the caller address and uses the atomic RPC", async () => {
    vi.stubEnv("SESSION_SECRET", "a-production-length-session-secret-1234");
    rpc.mockResolvedValue({ data: false, error: null });
    const request = new Request("https://app.dibs.chat", { headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" } });
    expect(await durableRateLimited(request, "onboarding", 5, 3600)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      requested_scope: "onboarding",
      requested_key_hash: createHmac("sha256", "a-production-length-session-secret-1234").update("onboarding:203.0.113.4").digest("hex"),
      requested_limit: 5,
      requested_window_seconds: 3600,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("203.0.113.4");
  });

  it("fails closed when durable storage is unavailable", async () => {
    vi.stubEnv("SESSION_SECRET", "a-production-length-session-secret-1234");
    rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await expect(durableRateLimited(new Request("https://app.dibs.chat"), "public_event", 60, 60)).rejects.toThrow("Rate limit unavailable");
  });
});