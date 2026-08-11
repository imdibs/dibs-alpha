import { describe, expect, it, vi } from "vitest";
import type { OutboundMessage } from "./messaging";
import { sendOrderedPhotonOutput } from "./photon-output";

describe("Photon ordered output transport", () => {
  it("sends each listing text immediately before that listing's photos", async () => {
    const sent: unknown[] = [];
    const space = { id: "space-1", send: vi.fn(async (content: unknown) => { sent.push(content); return { id: `sent-${sent.length}` }; }) };
    const output: OutboundMessage = {
      text: "aggregate history text",
      parts: [
        { type: "text", text: "found three" },
        { type: "text", text: "1/3\nfirst" },
        { type: "image", imageUrl: "https://images.test/1-a.jpg", listingNumber: 1, photoNumber: 1 },
        { type: "image", imageUrl: "https://images.test/1-b.jpg", listingNumber: 1, photoNumber: 2 },
        { type: "text", text: "2/3\nsecond" },
        { type: "image", imageUrl: "https://images.test/2-a.jpg", listingNumber: 2, photoNumber: 1 },
        { type: "text", text: "3/3\nthird" },
        { type: "image", imageUrl: "https://images.test/3-a.jpg", listingNumber: 3, photoNumber: 1 },
      ],
    };
    const record = vi.fn(async () => undefined);
    await sendOrderedPhotonOutput(space as never, "+13055550123", output, "dibs_reply", record);
    expect(sent[0]).toBe("found three");
    expect(sent[1]).toBe("1/3\nfirst");
    expect(sent[4]).toBe("2/3\nsecond");
    expect(sent[6]).toBe("3/3\nthird");
    expect(typeof sent[2]).not.toBe("string");
    expect(typeof sent[3]).not.toBe("string");
    expect(typeof sent[5]).not.toBe("string");
    expect(typeof sent[7]).not.toBe("string");
    expect(record).toHaveBeenCalledTimes(8);
  });

  it("keeps zero, one, and two-photo products separated without cross-contamination", async () => {
    const sent: unknown[] = [];
    const space = { id: "space-1", send: vi.fn(async (content: unknown) => { sent.push(content); return { id: `sent-${sent.length}` }; }) };
    const output: OutboundMessage = { text: "products", parts: [
      { type: "text", text: "1/3 — **no photos**" },
      { type: "text", text: "2/3 – *one photo*" },
      { type: "image", imageUrl: "https://images.test/2-a.jpg", listingNumber: 2, photoNumber: 1 },
      { type: "text", text: "3/3 — two photos" },
      { type: "image", imageUrl: "https://images.test/3-a.jpg", listingNumber: 3, photoNumber: 1 },
      { type: "image", imageUrl: "https://images.test/3-b.jpg", listingNumber: 3, photoNumber: 2 },
    ] };
    await sendOrderedPhotonOutput(space as never, "+13055550123", output, "dibs_reply", vi.fn(async () => undefined));
    expect(sent.map(item => typeof item === "string" ? item : "attachment")).toEqual([
      "1/3, no photos",
      "2/3, one photo", "attachment",
      "3/3, two photos", "attachment", "attachment",
    ]);
  });

  it("never sends duplicate or empty sanitized text responses", async () => {
    const sent: unknown[] = [];
    const space = { id: "space-1", send: vi.fn(async (content: unknown) => { sent.push(content); return { id: "sent" }; }) };
    await sendOrderedPhotonOutput(space as never, "+13055550123", {
      text: "```\n```",
      parts: [{ type: "text", text: "**what's the make and model?**" }, { type: "text", text: "what's the make and model?" }],
    }, "dibs_reply", vi.fn(async () => undefined));
    expect(sent).toEqual(["what's the make and model?"]);
  });
});