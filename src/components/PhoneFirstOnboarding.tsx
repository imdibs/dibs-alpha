"use client";

import React, { useState } from "react";

type OnboardingResponse = { accepted?: boolean; initiated?: boolean; error?: string };
type Props = { originatingListing?: string; visitorId?: string; attributionId?: string };

const trackingTokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicTokenPattern = /^[A-Za-z0-9_-]{12}$/;

function validTrackingToken(value: string | undefined): string | undefined {
  return value && trackingTokenPattern.test(value) ? value.toLowerCase() : undefined;
}

function validListingToken(value: string | undefined | null): string | undefined {
  return value && publicTokenPattern.test(value) ? value : undefined;
}

export function onboardingAttribution(props: Props = {}) {
  const queryListing = typeof location === "undefined" ? undefined : new URLSearchParams(location.search).get("from");
  return {
    visitorId: validTrackingToken(props.visitorId),
    attributionId: validTrackingToken(props.attributionId),
    originatingListing: validListingToken(props.originatingListing || queryListing),
  };
}

export function PhoneFirstOnboarding(props: Props) {
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<"pending" | "initiated" | null>(null);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || success) return;
    setBusy(true);
    setError("");
    const phone = String(new FormData(event.currentTarget).get("phone") || "");
    const attribution = onboardingAttribution(props);
    const body = { phone, source: "direct", ...Object.fromEntries(Object.entries(attribution).filter(([, value]) => value !== undefined)) };
    try {
      const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as OnboardingResponse;
      if (!response.ok || !data.accepted) throw new Error(data.error || "Dibs couldn't start the conversation. Please try again.");
      setSuccess(data.initiated ? "initiated" : "pending");
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dibs couldn't start the conversation. Please try again.");
      setBusy(false);
    }
  }

  return <section className="hero phone-first">
    <p className="eyebrow">Dibs over iMessage</p>
    <h1>Buy or sell anything by texting Dibs.</h1>
    <p className="muted">Enter your phone number and Dibs will start the conversation in Messages.</p>
    <form className="prompt" onSubmit={submit}>
      <label className="sr-only" htmlFor="dibs-phone">Phone number</label>
      <input id="dibs-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="Phone number" minLength={8} maxLength={32} required disabled={Boolean(success)}/>
      <button className="purple" disabled={busy || Boolean(success)}>{busy ? "Starting..." : success ? "Text requested" : "Text me!"}</button>
    </form>
    {success && <div className="notice phone-success" role="status"><strong>{success === "initiated" ? "Check your messages." : "Dibs will text you shortly."}</strong><br/>When Dibs texts, reply in Messages to get started.</div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}