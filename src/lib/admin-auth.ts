import { notFound } from "next/navigation";
import { currentUser } from "./auth";
import type { User } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function adminUserIds(value = process.env.ADMIN_USER_IDS): Set<string> {
  if (!value?.trim()) return new Set();
  const ids = value.split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
  if (ids.some(id => !UUID.test(id))) throw new Error("ADMIN_USER_IDS must contain only comma-separated UUIDs");
  return new Set(ids);
}

export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  if (!user || !adminUserIds().has(user.id.toLowerCase())) notFound();
  return user;
}