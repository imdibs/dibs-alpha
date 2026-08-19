import { durableRateLimited, rateLimitKeyHash } from "./rate-limit";
export function onboardingRateLimited(request: Request): Promise<boolean> { return durableRateLimited(request, "onboarding", 5, 60 * 60); }
export function onboardingRecipientKeyHash(normalizedPhone: string): string { return rateLimitKeyHash("onboarding_recipient", normalizedPhone); }