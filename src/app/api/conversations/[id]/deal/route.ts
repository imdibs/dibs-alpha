import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { matchingCounterpartyReport } from "@/lib/deal-signals";
import { capturePostHog } from "@/lib/posthog";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); const { id } = await context.params;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const client = db();
  const conversation = await client.from("conversations").select("id,listing_id,buyer_id,seller_id").eq("id", id).maybeSingle();
  const c = conversation.data;
  if (!c || ![c.buyer_id, c.seller_id].includes(user.id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const parsed = z.object({ price: z.coerce.number().positive().max(1000000), evidence: z.string().trim().min(3).max(500) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Add the price and what happened." }, { status: 400 });
  const source = user.id === c.buyer_id ? "buyer_report" : "seller_report";
  const priceCents = Math.round(parsed.data.price * 100);
  const reports = await client.from("deal_signals").select("reported_by,evidence").eq("conversation_id", id).in("source", ["buyer_report", "seller_report"]);
  if (reports.error) return NextResponse.json({ error: "Could not check existing reports." }, { status: 500 });
  const existingOwnReport = (reports.data || []).find(report => report.reported_by === user.id);
  if (existingOwnReport) return NextResponse.json({ error: "You already recorded your report." }, { status: 409 });
  const signal = await client.from("deal_signals").insert({
    conversation_id: id, listing_id: c.listing_id, buyer_id: c.buyer_id, seller_id: c.seller_id,
    status: "likely", source, reported_by: user.id, confidence: 0.85,
    evidence: { statement: parsed.data.evidence, reportedPriceCents: priceCents },
  }).select("status,confidence,evidence,created_at").single();
  if (signal.error) return NextResponse.json({ error: signal.error.code === "23505" ? "You already recorded your report." : "Could not record that signal." }, { status: signal.error.code === "23505" ? 409 : 500 });
  const refreshed = await client.from("deal_signals").select("reported_by,evidence").eq("conversation_id", id).in("source", ["buyer_report", "seller_report"]);
  if (refreshed.error) return NextResponse.json({ ...signal.data, warning: "Confirmation is pending." });
  const counterpart = matchingCounterpartyReport(refreshed.data || [], user.id, priceCents);
  if (!counterpart) return NextResponse.json(signal.data);

  const deal = await client.from("deals").upsert({ conversation_id: id, listing_id: c.listing_id, buyer_id: c.buyer_id, seller_id: c.seller_id, agreed_price_cents: priceCents, source: "participant_bilateral_reports", confidence: 1 }, { onConflict: "conversation_id", ignoreDuplicates: true }).select("id").maybeSingle();
  if (deal.error) return NextResponse.json({ error: "Your report was saved, but confirmation could not be completed." }, { status: 500 });
  const confirmed = await client.from("deal_signals").insert({
    conversation_id: id, listing_id: c.listing_id, buyer_id: c.buyer_id, seller_id: c.seller_id,
    status: "confirmed", source: "bilateral_confirmation", reported_by: null, confidence: 1,
    evidence: { buyerReportUserId: c.buyer_id, sellerReportUserId: c.seller_id, agreedPriceCents: priceCents },
  });
  if (confirmed.error && !String(confirmed.error.code).includes("23505")) console.warn("Could not record confirmed audit signal", confirmed.error);
  capturePostHog({ event: "deal_completed", distinctId: user.id, properties: { channel: "web" } });
  return NextResponse.json({ ...signal.data, status: "confirmed" });
}