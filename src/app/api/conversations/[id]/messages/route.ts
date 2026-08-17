import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { authorizedConversation, persistParticipantMessage } from "@/lib/marketplace";
import { messageSchema } from "@/lib/validation";
import { captureDibsError, capturePostHog } from "@/lib/posthog";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); const { id } = await context.params;
  if (!user || !await authorizedConversation(id, user.id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const result = await db().from("messages").select("id,body,sender_id,message_kind,participant_role,created_at,sender:users!sender_id(name)").eq("conversation_id", id).order("created_at");
  return NextResponse.json({ messages: result.data || [] });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser(); const { id } = await context.params;
  const conversation = user ? await authorizedConversation(id, user.id) : null;
  if (!user || !conversation) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const parsed = messageSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Write a message." }, { status: 400 });
  try {
    const message = await persistParticipantMessage({ conversation, senderId: user.id, body: parsed.data.body });
    capturePostHog({ event: "message_sent", distinctId: user.id, properties: { channel: "web", message_kind: "participant", direction: "outbound" } });
    return NextResponse.json(message, { status: 201 });
  } catch {
    capturePostHog({ event: "message_delivery_failed", distinctId: user.id, properties: { channel: "web", failure_type: "persistence_failed", retryable: true } });
    captureDibsError({ distinctId: user.id, subsystem: "marketplace", errorType: "message_persistence_failed", retryable: true });
    return NextResponse.json({ error: "Could not send message." }, { status: 500 });
  }
}