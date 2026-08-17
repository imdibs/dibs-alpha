import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getOrCreateConversation } from "@/lib/marketplace";
import { getPublicListing } from "@/lib/public-listings";
import { trackingContext } from "@/lib/tracking";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Join Dibs first." }, { status: 401 });
  const { token } = await context.params;
  const listing = await getPublicListing(token);
  if (!listing || listing.status !== "active") return NextResponse.json({ error: "Listing is unavailable." }, { status: 404 });
  if (listing.seller_id === user.id) return NextResponse.json({ error: "This is your listing." }, { status: 400 });
  try {
    const tracking = trackingContext(request);
    const conversation = await getOrCreateConversation(listing.id, user.id, {
      visitorId: tracking.visitorId,
      attributionToken: tracking.attributionToken,
      source: tracking.acquisitionSource,
      originListingToken: tracking.originListingToken,
    });
    return NextResponse.json({ id: conversation.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start conversation." }, { status: 400 });
  }
}