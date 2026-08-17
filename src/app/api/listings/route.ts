import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listingSchema } from "@/lib/validation";
import { capturePostHog } from "@/lib/posthog";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const form = await request.formData();
  const parsed = listingSchema.safeParse(Object.fromEntries(form.entries()));
  const photos = form.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);
  if (!parsed.success || photos.length < 2 || photos.length > 6) return NextResponse.json({ error: "Complete every field and add 2 to 6 photos." }, { status: 400 });
  if (photos.some(photo => photo.size > 8_000_000 || !photo.type.startsWith("image/"))) return NextResponse.json({ error: "Each photo must be an image under 8 MB." }, { status: 400 });
  const client = db();
  const imageUrls: string[] = [];
  for (const photo of photos) {
    const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
    const uploaded = await client.storage.from("listing-images").upload(path, photo, { contentType: photo.type });
    if (uploaded.error) return NextResponse.json({ error: "Photo upload failed." }, { status: 500 });
    imageUrls.push(client.storage.from("listing-images").getPublicUrl(path).data.publicUrl);
  }
  const listing = await client.from("listings").insert({
    seller_id: user.id, title: parsed.data.title, description: parsed.data.description,
    price_cents: Math.round(parsed.data.price * 100), condition: parsed.data.condition,
    city: parsed.data.city, image_urls: imageUrls, status: "active", published_at: new Date().toISOString(),
  }).select("id,public_token").single();
  if (listing.error) return NextResponse.json({ error: "Could not publish listing." }, { status: 500 });
  capturePostHog({ event: "listing_created", distinctId: user.id, properties: { listing_id: listing.data.id, condition: parsed.data.condition, city: parsed.data.city, price_cents: Math.round(parsed.data.price * 100), seller_or_buyer_role: "seller" } });
  capturePostHog({ event: "sell_request", distinctId: user.id, properties: { city: parsed.data.city, channel: "web" } });
  return NextResponse.json({ id: listing.data.id, publicToken: listing.data.public_token }, { status: 201 });
}