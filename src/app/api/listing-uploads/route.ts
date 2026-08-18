import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { LISTING_IMAGE_BUCKET, listingUploadAuthorizationSchema, listingUploadCancellationSchema, listingUploadPath } from "@/lib/listing-uploads";

type CleanupRow = { upload_id: string; object_path: string; cleanup_token: string };
function rows<T>(value: T | T[] | null): T[] { return !value ? [] : Array.isArray(value) ? value : [value]; }
async function removeClaimedObjects(claimed: CleanupRow[]): Promise<void> {
  if (!claimed.length) return;
  const uploadIds = claimed.map(item => item.upload_id);
  const cleanupToken = claimed[0].cleanup_token;
  if (!cleanupToken || claimed.some(item => item.cleanup_token !== cleanupToken)) throw new Error("Invalid upload cleanup claim");
  const client = db();
  try {
    const removed = await client.storage.from(LISTING_IMAGE_BUCKET).remove(claimed.map(item => item.object_path));
    if (removed.error) throw new Error("Could not remove uploaded objects");
    const completed = await client.rpc("complete_web_listing_upload_cleanup", { requested_upload_ids: uploadIds, requested_cleanup_token: cleanupToken });
    if (completed.error || completed.data !== uploadIds.length) throw new Error("Could not complete upload cleanup");
  } catch (error) {
    await client.rpc("release_web_listing_upload_cleanup", { requested_upload_ids: uploadIds, requested_cleanup_token: cleanupToken });
    throw error;
  }
}
async function cleanupExpiredUploads(): Promise<void> {
  const result = await db().rpc("cleanup_expired_web_listing_uploads", { requested_limit: 24 });
  if (result.error) throw new Error("Could not claim expired uploads");
  await removeClaimedObjects(rows(result.data as CleanupRow | CleanupRow[] | null));
}
async function cancelUploads(userId: string, uploadIds: string[]): Promise<void> {
  const result = await db().rpc("cancel_web_listing_uploads", { requested_user_id: userId, requested_upload_ids: uploadIds });
  if (result.error) throw new Error("Could not claim cancelled uploads");
  await removeClaimedObjects(rows(result.data as CleanupRow | CleanupRow[] | null));
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Choose 2 to 6 supported images under 8 MB each." }, { status: 400 }); }
  const parsed = listingUploadAuthorizationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose 2 to 6 JPEG, PNG, WebP, GIF, HEIC, or HEIF images under 8 MB each." }, { status: 400 });
  await cleanupExpiredUploads().catch(() => undefined);
  const uploads = parsed.data.files.map(file => { const id = crypto.randomUUID(); return { id, ...file, objectPath: listingUploadPath(user.id, id, file.contentType) }; });
  const client = db();
  const inserted = await client.from("web_listing_uploads").insert(uploads.map(upload => ({
    id: upload.id, user_id: user.id, bucket_id: LISTING_IMAGE_BUCKET, object_path: upload.objectPath, content_type: upload.contentType, size_bytes: upload.size,
  })));
  if (inserted.error) return NextResponse.json({ error: "Could not prepare photo uploads." }, { status: 503 });
  try {
    const authorized = await Promise.all(uploads.map(async upload => {
      const signed = await client.storage.from(LISTING_IMAGE_BUCKET).createSignedUploadUrl(upload.objectPath, { upsert: false });
      if (signed.error) throw new Error("Could not sign upload");
      return { id: upload.id, signedUrl: signed.data.signedUrl };
    }));
    return NextResponse.json({ uploads: authorized });
  } catch {
    await cancelUploads(user.id, uploads.map(upload => upload.id)).catch(() => undefined);
    return NextResponse.json({ error: "Could not prepare photo uploads." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid upload cancellation." }, { status: 400 }); }
  const parsed = listingUploadCancellationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload cancellation." }, { status: 400 });
  try {
    await cancelUploads(user.id, parsed.data.uploadIds);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not cancel photo uploads. Try again." }, { status: 503 });
  }
}