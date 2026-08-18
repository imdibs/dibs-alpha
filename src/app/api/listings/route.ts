import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listingPublicationSchema, supabaseStorageOrigin } from "@/lib/listing-uploads";
import { capturePostHog } from "@/lib/posthog";

type CreatedListing = { id: string; public_token: string };
function firstRow<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] || null : value; }

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Complete every field and add 2 to 6 photos." }, { status: 400 }); }
  const parsed = listingPublicationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Complete every field and add 2 to 6 photos." }, { status: 400 });
  const priceCents = Math.round(parsed.data.price * 100);
  const result = await db().rpc("publish_web_listing", {
    requested_user_id: user.id, requested_upload_ids: parsed.data.uploadIds, requested_title: parsed.data.title,
    requested_description: parsed.data.description, requested_price_cents: priceCents, requested_condition: parsed.data.condition,
    requested_city: parsed.data.city, requested_storage_origin: supabaseStorageOrigin(),
  });
  const listing = firstRow(result.data as CreatedListing | CreatedListing[] | null);
  if (result.error || !listing) {
    const status = result.error?.code === "P0001" || result.error?.code === "23514" ? 400 : 503;
    return NextResponse.json({ error: status === 400 ? "Photo uploads are invalid or expired. Upload them again." : "Could not publish listing." }, { status });
  }
  capturePostHog({ event: "listing_created", distinctId: user.id, properties: { listing_id: listing.id, condition: parsed.data.condition, city: parsed.data.city, price_cents: priceCents, seller_or_buyer_role: "seller" } });
  capturePostHog({ event: "sell_request", distinctId: user.id, properties: { city: parsed.data.city, channel: "web" } });
  return NextResponse.json({ id: listing.id, publicToken: listing.public_token }, { status: 201 });
}