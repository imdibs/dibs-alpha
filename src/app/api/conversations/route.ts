import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getOrCreateConversation } from "@/lib/marketplace";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { listingId } = await request.json();
  try {
    return NextResponse.json(await getOrCreateConversation(listingId, user.id), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start conversation.";
    return NextResponse.json({ error: message }, { status: message === "Listing is unavailable." ? 404 : 400 });
  }
}