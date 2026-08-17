import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, makeSession, sessionCookie, verifyPassword } from "@/lib/auth";
import { profileSchema } from "@/lib/validation";
import { recordProductEvent } from "@/lib/analytics";
import { getPublicListing } from "@/lib/public-listings";
import { trackingContext } from "@/lib/tracking";
import { capturePostHog } from "@/lib/posthog";

export async function POST(request: Request) {
  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid name, email, and city." }, { status: 400 });
  const client = db();
  const existing = await client.from("users").select("id,password_hash").eq("email", parsed.data.email).maybeSingle();
  let id = existing.data?.id;
  if (existing.data && !await verifyPassword(parsed.data.password, existing.data.password_hash)) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }
  if (!id) {
    const { password, ...profile } = parsed.data;
    const tracking = trackingContext(request);
    const source = tracking.acquisitionSource || "direct";
    const origin = tracking.originListingToken ? await getPublicListing(tracking.originListingToken) : null;
    const now = new Date().toISOString();
    const created = await client.from("users").insert({ ...profile, password_hash: await hashPassword(password), activated_at: now, acquisition_source: source, originating_listing_id: origin?.id || null, acquisition_at: now }).select("id").single();
    if (created.error) return NextResponse.json({ error: "Could not create profile." }, { status: 500 });
    id = created.data.id;
    capturePostHog({ event: "user_signed_up", distinctId: id, properties: { source, city: parsed.data.city, onboarding_method: "web_profile" } });
    capturePostHog({ event: "onboarding_completed", distinctId: id, properties: { source, onboarding_method: "web_profile" } });
    await recordProductEvent({ eventName: origin ? "shared_listing_user_activated" : "user_activated", userId: id, listingId: origin?.id, visitorId: tracking.visitorId, attributionToken: tracking.attributionToken, source }).catch(error => console.warn("Could not record activation event", error));
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie, makeSession(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}