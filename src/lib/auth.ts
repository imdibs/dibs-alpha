import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db } from "./db";
import type { User } from "./types";

const COOKIE = "dibs_session";
function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return value;
}
function signature(id: string) { return createHmac("sha256", secret()).update(id).digest("base64url"); }
export function makeSession(id: string) { return `${id}.${signature(id)}`; }
export function verifySession(value?: string) {
  if (!value) return null;
  const [id, supplied] = value.split(".");
  if (!id || !supplied) return null;
  const expected = signature(id);
  if (supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  return id;
}
const deriveKey = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const supplied = await deriveKey(password, salt, expected.length) as Buffer;
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export async function currentUser(): Promise<User | null> {
  const id = verifySession((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const { data } = await db().from("users").select("id,name,email,city").eq("id", id).maybeSingle();
  return data;
}
export const sessionCookie = COOKIE;