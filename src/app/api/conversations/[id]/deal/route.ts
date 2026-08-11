import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const client = db();
  const conversation = await client.from("conversations").select("id,listing_id,buyer_id,seller_id").eq("id", id).maybeSingle();
  const c = conversation.data;
  if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const parsed = z.object({ price: z.coerce.number().positive().max(1000000) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter the agreed price." }, { status: 400 });
  const deal = await client.from("deals").upsert({ conversation_id: id, listing_id: c.listing_id, buyer_id: c.buyer_id, seller_id: c.seller_id, agreed_price_cents: Math.round(parsed.data.price * 100), agreed_at: new Date().toISOString() }, { onConflict: "conversation_id" }).select("*").single();
  if (deal.error) return NextResponse.json({ error: "Could not record deal." }, { status: 500 });
  return NextResponse.json(deal.data);
}