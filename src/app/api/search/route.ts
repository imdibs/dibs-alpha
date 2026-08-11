import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { searchListings } from "@/lib/listing-search";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await request.json();
  if (typeof body.query !== "string" || body.query.trim().length < 2 || body.query.length > 300) return NextResponse.json({ error: "Tell Dibs what you want." }, { status: 400 });
  try {
    return NextResponse.json(await searchListings(body.query, user.city || undefined));
  } catch {
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}