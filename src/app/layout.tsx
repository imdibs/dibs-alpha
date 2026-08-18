import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

function metadataBase(): URL {
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
  return url;
}

export const metadata: Metadata = { metadataBase: metadataBase(), title: "Dibs | Buy and sell through text in Miami", description: "Dibs is live in Miami. Buy and sell through text." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><Link className="brand" href="/">dibs<span>.</span></Link><nav><Link href="/sell">Sell</Link><Link href="/inbox">Inbox</Link></nav></header><main>{children}</main></body></html>;
}