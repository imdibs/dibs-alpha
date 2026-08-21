import { db } from "./db";
import type { Listing } from "./types";
import { publicTokenSchema } from "./validation";

export type PublicListing = Pick<Listing, "id" | "seller_id" | "title" | "description" | "price_cents" | "condition" | "city" | "image_urls" | "status" | "public_token" | "category" | "published_at" | "updated_at" | "sold_at">;

export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) throw new Error("NEXT_PUBLIC_SITE_URL must be configured as an HTTP(S) origin");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be configured as an HTTP(S) origin");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin");
  }
  return url.origin;
}

export function publicListingUrl(token: string): string {
  return `${siteUrl()}/l/${publicTokenSchema.parse(token)}`;
}

export async function getPublicListing(token: string): Promise<PublicListing | null> {
  const parsed = publicTokenSchema.safeParse(token);
  if (!parsed.success) return null;
  const result = await db().from("listings")
    .select("id,seller_id,title,description,price_cents,condition,city,image_urls,status,public_token,category,published_at,updated_at,sold_at")
    .eq("public_token", parsed.data)
    .eq("status", "active")
    .maybeSingle();
  if (result.error) throw new Error("Could not load public listing.");
  return result.data as PublicListing | null;
}