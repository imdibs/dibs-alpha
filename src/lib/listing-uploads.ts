import { z } from "zod";
import { listingSchema } from "./validation";

export const LISTING_IMAGE_BUCKET = "listing-images";
export const LISTING_IMAGE_MAX_BYTES = 8_000_000;
export const LISTING_IMAGE_MIN_COUNT = 2;
export const LISTING_IMAGE_MAX_COUNT = 6;
export const LISTING_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"] as const;

const mimeSchema = z.enum(LISTING_IMAGE_MIME_TYPES);
export const listingUploadAuthorizationSchema = z.object({ files: z.array(z.object({
  contentType: mimeSchema, size: z.number().int().positive().max(LISTING_IMAGE_MAX_BYTES),
}).strict()).min(LISTING_IMAGE_MIN_COUNT).max(LISTING_IMAGE_MAX_COUNT) }).strict();
export const listingUploadCancellationSchema = z.object({ uploadIds: z.array(z.string().uuid()).min(1).max(LISTING_IMAGE_MAX_COUNT) }).strict();
export const listingPublicationSchema = listingSchema.extend({
  uploadIds: z.array(z.string().uuid()).min(LISTING_IMAGE_MIN_COUNT).max(LISTING_IMAGE_MAX_COUNT),
}).strict().refine(value => new Set(value.uploadIds).size === value.uploadIds.length, { message: "Upload authorizations must be unique.", path: ["uploadIds"] });

export function listingImageExtension(contentType: typeof LISTING_IMAGE_MIME_TYPES[number]): string {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif" } as const)[contentType];
}
export function listingUploadPath(userId: string, uploadId: string, contentType: typeof LISTING_IMAGE_MIME_TYPES[number]): string {
  return `${userId}/web-listing-uploads/${uploadId}.${listingImageExtension(contentType)}`;
}
export function supabaseStorageOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) throw new Error("Supabase environment variables are not configured");
  const url = new URL(configured);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("NEXT_PUBLIC_SUPABASE_URL must be an origin");
  return url.origin;
}