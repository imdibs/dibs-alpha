import { durableRateLimited } from "./rate-limit";
export function publicEventRateLimited(request: Request): Promise<boolean> { return durableRateLimited(request, "public_event", 60, 60); }