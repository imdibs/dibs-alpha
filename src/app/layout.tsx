import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://dibs.chat"), title: "Dibs | Buy and sell through text in Miami", description: "Dibs is live in Miami. Buy and sell through text." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><Link className="brand" href="/">dibs<span>.</span></Link><nav><Link href="/sell">Sell</Link><Link href="/inbox">Inbox</Link></nav></header><main>{children}</main></body></html>;
}