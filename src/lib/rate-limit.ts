import { createHmac } from "node:crypto";
import { db } from "./db";

type RateLimitScope = "onboarding" | "public_event";
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return secret;
}
function callerAddress(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function durableRateLimited(request: Request, scope: RateLimitScope, limit: number, windowSeconds: number): Promise<boolean> {
  const keyHash = createHmac("sha256", sessionSecret()).update(`${scope}:${callerAddress(request)}`).digest("hex");
  const result = await db().rpc("check_rate_limit", {
    requested_scope: scope, requested_key_hash: keyHash, requested_limit: limit, requested_window_seconds: windowSeconds,
  });
  if (result.error || typeof result.data !== "boolean") throw new Error("Rate limit unavailable");
  return result.data;
}