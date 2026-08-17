import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchListings } from "@/lib/listing-search";
import { capturePostHog, captureDibsError } from "@/lib/posthog";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json();
  if (typeof body.query !== "string" || body.query.trim().length < 2 || body.query.length > 300) return NextResponse.json({ error: "Tell Dibs what you want." }, { status: 400 });
  try {
    const result = await searchListings(body.query, user.city || undefined);
    capturePostHog({ event: "product_search", distinctId: user.id, properties: { city: result.intent.city || user.city, intent: "buy", channel: "web" } });
    capturePostHog({ event: "buy_request", distinctId: user.id, properties: { city: result.intent.city || user.city, channel: "web" } });
    return NextResponse.json(result);
  } catch {
    captureDibsError({ distinctId: user.id, subsystem: "marketplace", errorType: "search_failed", retryable: true });
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}