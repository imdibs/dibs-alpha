import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, makeSession, sessionCookie, verifyPassword } from "@/lib/auth";
import { profileSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const parsed = profileSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid name, email, and city." }, { status: 400 });
  const client = db();
  const existing = await client.from("users").select("id,password_hash").eq("email", parsed.data.email).maybeSingle();
  let id = existing.data?.id;
  if (existing.data && !await verifyPassword(parsed.data.password, existing.data.password_hash)) {
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }
  if (!id) {
    const { password, ...profile } = parsed.data;
    const created = await client.from("users").insert({ ...profile, password_hash: await hashPassword(password) }).select("id").single();
    if (created.error) return NextResponse.json({ error: "Could not create profile." }, { status: 500 });
    id = created.data.id;
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookie, makeSession(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  return response;
}