import { headers } from "next/headers";
import { notFound } from "next/navigation";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function hostnameFromHostHeader(host: string | null): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function requireLocalAdmin(): Promise<void> {
  if (process.env.NODE_ENV === "production") notFound();

  const hostname = hostnameFromHostHeader((await headers()).get("host"));
  if (!hostname || !LOCAL_HOSTNAMES.has(hostname)) notFound();
}