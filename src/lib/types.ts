export type User = { id: string; name: string | null; email: string | null; city: string | null };
export type Listing = {
  id: string; seller_id: string; title: string; description: string;
  price_cents: number; condition: string; city: string; image_urls: string[];
  status: string; created_at: string; public_token?: string; category?: string | null;
  published_at?: string | null; updated_at?: string; sold_at?: string | null; seller?: { name: string };
};
export type SearchIntent = { query: string; maxPriceCents?: number; city?: string };