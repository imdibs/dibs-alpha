"use client";
import { useState } from "react";
import { LISTING_IMAGE_MAX_BYTES, LISTING_IMAGE_MAX_COUNT, LISTING_IMAGE_MIME_TYPES, LISTING_IMAGE_MIN_COUNT } from "@/lib/listing-uploads";

type AuthorizedUpload = { id: string; signedUrl: string };
async function responseJson(response: Response): Promise<Record<string, unknown>> { try { return await response.json() as Record<string, unknown>; } catch { return {}; } }
async function uploadFile(file: File, upload: AuthorizedUpload): Promise<void> {
  const body = new FormData(); body.append("cacheControl", "3600"); body.append("", file);
  const response = await fetch(upload.signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body });
  if (!response.ok) throw new Error("Photo upload failed. Try again.");
}

export function SellForm({ city }: { city: string }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = event.currentTarget; const values = new FormData(form); const input = form.elements.namedItem("photos") as HTMLInputElement;
    const photos = Array.from(input.files || []); const supportedTypes = new Set<string>(LISTING_IMAGE_MIME_TYPES);
    if (photos.length < LISTING_IMAGE_MIN_COUNT || photos.length > LISTING_IMAGE_MAX_COUNT) { setError("Add 2 to 6 photos."); setBusy(false); return; }
    if (photos.some(photo => !supportedTypes.has(photo.type) || photo.size <= 0 || photo.size > LISTING_IMAGE_MAX_BYTES)) { setError("Use JPEG, PNG, WebP, GIF, HEIC, or HEIF photos under 8 MB each."); setBusy(false); return; }
    let uploadIds: string[] = [];
    try {
      const authorizationResponse = await fetch("/api/listing-uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: photos.map(photo => ({ contentType: photo.type, size: photo.size })) }) });
      const authorization = await responseJson(authorizationResponse);
      if (!authorizationResponse.ok) throw new Error(String(authorization.error || "Could not prepare photo uploads."));
      const uploads = authorization.uploads as AuthorizedUpload[]; uploadIds = uploads.map(upload => upload.id);
      await Promise.all(photos.map((photo, index) => uploadFile(photo, uploads[index])));
      const response = await fetch("/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: values.get("title"), description: values.get("description"), price: Number(values.get("price")), condition: values.get("condition"), city: values.get("city"), uploadIds }) });
      const data = await responseJson(response); if (!response.ok) throw new Error(String(data.error || "Could not publish listing."));
      location.href = `/l/${data.publicToken}`;
    } catch (caught) {
      if (uploadIds.length) void fetch("/api/listing-uploads", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadIds }) });
      setError(caught instanceof Error ? caught.message : "Could not publish listing."); setBusy(false);
    }
  }
  return <form onSubmit={submit}><label>Photos (2 to 6)</label><input type="file" name="photos" accept={LISTING_IMAGE_MIME_TYPES.join(",")} multiple required/><label>What is it?</label><input name="title" placeholder="PS5 Slim + 2 Controllers" required maxLength={120}/><label>Describe it honestly</label><textarea name="description" placeholder="Fully working, includes two controllers…" required maxLength={2000}/><div className="row"><div><label>Price</label><input name="price" type="number" min="1" step="0.01" placeholder="275" required/></div><div><label>Condition</label><select name="condition" defaultValue="good"><option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option></select></div></div><label>Miami area</label><input name="city" defaultValue={city} required/>{error&&<p className="error">{error}</p>}<p><button disabled={busy}>{busy?"Publishing…":"Publish listing"}</button></p></form>;
}