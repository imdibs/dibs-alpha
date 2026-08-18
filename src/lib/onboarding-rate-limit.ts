import { durableRateLimited } from "./rate-limit";
export function onboardingRateLimited(request: Request): Promise<boolean> { return durableRateLimited(request, "onboarding", 5, 60 * 60); }