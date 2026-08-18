// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneFirstOnboarding } from "./PhoneFirstOnboarding";

const visitorId = "550e8400-e29b-41d4-a716-446655440000";
const attributionId = "550e8400-e29b-41d4-a716-446655440001";
const listingToken = "7xK92pAb_Cde";

function submit(phone = "305-555-0123") {
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: "Text me!" }));
}

describe("PhoneFirstOnboarding", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    history.replaceState({}, "", "/");
  });
  afterEach(cleanup);

  it("submits the phone, direct source, and valid attribution to the existing endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true, initiated: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<PhoneFirstOnboarding visitorId={visitorId} attributionId={attributionId} originatingListing={listingToken}/>);
    submit();
    await screen.findByText("Dibs will text you shortly.");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "305-555-0123", source: "direct", visitorId, attributionId, originatingListing: listingToken }),
    });
  });

  it("shows the sent/replied state and keeps submission disabled after success", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true, initiated: true }) });
    vi.stubGlobal("fetch", fetch);
    render(<PhoneFirstOnboarding/>);
    submit();
    await screen.findByText("Check your messages.");
    const button = screen.getByRole("button", { name: "Text requested" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("prevents a duplicate submission while the first request is pending", async () => {
    let resolve!: (value: unknown) => void;
    const fetch = vi.fn(() => new Promise(value => { resolve = value; }));
    vi.stubGlobal("fetch", fetch);
    render(<PhoneFirstOnboarding/>);
    submit();
    const button = screen.getByRole("button", { name: "Starting..." });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledOnce();
    resolve({ ok: true, json: async () => ({ accepted: true, initiated: false }) });
    await screen.findByText("Dibs will text you shortly.");
  });

  it("shows an API error and allows retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Too many requests. Try again later." }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accepted: true, initiated: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<PhoneFirstOnboarding/>);
    submit();
    await screen.findByRole("alert");
    expect(screen.getByText("Too many requests. Try again later.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Text me!" }) as HTMLButtonElement).disabled).toBe(false);
    submit();
    await screen.findByText("Dibs will text you shortly.");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves a valid originating listing from the from query parameter", async () => {
    history.replaceState({}, "", `/?from=${listingToken}`);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accepted: true, initiated: false }) });
    vi.stubGlobal("fetch", fetch);
    render(<PhoneFirstOnboarding/>);
    submit();
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ phone: "305-555-0123", source: "direct", originatingListing: listingToken });
  });
});