"use client";

import { useEffect, useState } from "react";

export async function recordPublicEvent(eventName: string, listingToken: string, source: string): Promise<void> {
  try {
    const response = await fetch("/api/public-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventName, listingToken, source }) });
    if (!response.ok) console.warn("Public analytics request failed", response.status);
  } catch (error) {
    console.warn("Public analytics request failed", error);
  }
}

export function PublicListingActions({ token, title, active, authenticated }: { token: string; title: string; active: boolean; authenticated: boolean }) {
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void recordPublicEvent("listing_page_viewed", token, "public_share");
  }, [token]);
  async function contact() {
    setError("");
    void recordPublicEvent("listing_cta_clicked", token, "marketplace");
    if (!authenticated) { location.href = `/?from=${encodeURIComponent(token)}`; return; }
    const response = await fetch(`/api/public-listings/${token}/contact`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error); return; }
    location.href = `/conversations/${data.id}`;
  }
  async function share() {
    const url = `${location.origin}/l/${token}`;
    void recordPublicEvent("listing_share_link_generated", token, "public_share");
    if (navigator.share) await navigator.share({ title, text: `${title} on Dibs`, url });
    else { await navigator.clipboard.writeText(url); setCopied(true); }
  }
  return <div className="public-actions">{active&&<button className="purple" onClick={contact}>Ask Dibs about this</button>}<button onClick={share}>{copied?"Link copied":"Share listing"}</button>{error&&<p className="error">{error}</p>}</div>;
}