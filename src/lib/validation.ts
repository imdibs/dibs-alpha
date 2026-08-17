import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  city: z.string().trim().min(2).max(100),
  password: z.string().min(8).max(128),
});
export const listingSchema = z.object({
  title: z.string().trim().min(3).max(120), description: z.string().trim().min(3).max(2000),
  price: z.coerce.number().positive().max(1000000),
  condition: z.enum(["new", "like_new", "good", "fair"]), city: z.string().trim().min(2).max(100),
});
export const messageSchema = z.object({ body: z.string().max(2000).refine(value => value.trim().length > 0) });
export const publicTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);