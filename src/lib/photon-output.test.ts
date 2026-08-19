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
    const result = await sendOrderedPhotonOutput(space as never, "+13055550123", output, "dibs_reply", record);
    expect(sent[0]).toBe("found three");
    expect(sent[1]).toBe("1/3\nfirst");
    expect(sent[4]).toBe("2/3\nsecond");
    expect(sent[6]).toBe("3/3\nthird");
    expect(typeof sent[2]).not.toBe("string");
    expect(typeof sent[3]).not.toBe("string");
    expect(typeof sent[5]).not.toBe("string");
    expect(typeof sent[7]).not.toBe("string");
    expect(record).toHaveBeenCalledTimes(8);
    expect(result.textMessages.map(item => item.id)).toEqual(["sent-1", "sent-2", "sent-5", "sent-7"]);
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

  it("surfaces a failed send instead of silently swallowing it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const space = { id: "space-1", send: vi.fn()
      .mockRejectedValueOnce(new TypeError(`provider rejected https://private.test token=secret-value ${"x".repeat(600)}`)) };
    const record = vi.fn(async () => undefined);

    await expect(sendOrderedPhotonOutput(space as never, "+13055550123", {
      text: "hello",
    }, "dibs_reply", record)).rejects.toThrow("provider rejected");

    expect(record).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    const entry = JSON.parse(String(logged.mock.calls[0][0]));
    expect(entry).toMatchObject({
      level: "error",
      event: "photon_text_send_failed",
      service: "dibs-photon-output",
      error_type: "TypeError",
      space_id: "space-1",
      message_kind: "dibs_reply",
    });
    expect(entry.error_message).toContain("provider rejected [REDACTED_URL] token=[REDACTED]");
    expect(entry.error_message).not.toContain("secret-value");
    expect(entry.error_message).toHaveLength(500);
    logged.mockRestore();
  });

  it("does not treat recording failure after a successful send as delivery failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sentAt = new Date("2026-08-11T12:00:01.000Z");
    const space = { id: "space-1", send: vi.fn(async () => ({ id: "outbound-1", timestamp: sentAt })) };
    const recordError = new Error("database unavailable");
    const record = vi.fn(async () => { throw recordError; });

    const result = await sendOrderedPhotonOutput(space as never, "+13055550123", {
      text: "delivered text",
    }, "dibs_reply", record);

    expect(space.send).toHaveBeenCalledOnce();
    expect(result.textMessages).toEqual([{ id: "outbound-1", occurredAt: sentAt.toISOString() }]);
    expect(warning).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warning.mock.calls[0][0]))).toMatchObject({
      level: "warn",
      event: "photon_outbound_recording_failed",
      error_type: "Error",
      error_message: "database unavailable",
      space_id: "space-1",
      message_kind: "dibs_reply",
    });
    warning.mockRestore();
  });
});