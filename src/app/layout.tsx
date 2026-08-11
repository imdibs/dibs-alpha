import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "Dibs — Ask AI. Find Anything.", description: "Buy and sell by talking to Dibs." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><header><Link className="brand" href="/">dibs<span>.</span></Link><nav><Link href="/sell">Sell</Link><Link href="/inbox">Inbox</Link></nav></header><main>{children}</main></body></html>;
}