import { describe, expect, it, vi } from "vitest";
import type { AiClient } from "../ai/types";
import { decideFollowup } from "./decision";

function client(value: unknown): AiClient {
  return { complete: vi.fn(async () => JSON.stringify(value)) };
}

describe("follow-up usefulness decision", () => {
  it("accepts a bounded useful follow-up", async () => {
    const ai = client({ action: "notify", reason: "answers the open question", message: "still looking for a PS5 under $300?" });
    await expect(decideFollowup({ kind: "unanswered_10m", history: [{ role: "user", body: "PS5 under $300" }] }, ai)).resolves.toEqual({
      action: "notify", reason: "answers the open question", message: "still looking for a PS5 under $300?",
    });
    expect(ai.complete).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ additionalProperties: false }));
  });

  it("accepts ignore without a message", async () => {
    await expect(decideFollowup({ kind: "final_24h", history: [] }, client({ action: "ignore", reason: "nothing useful", message: null }))).resolves.toEqual({ action: "ignore", reason: "nothing useful" });
  });

  it.each([
    { action: "notify", reason: "missing", message: null },
    { action: "ignore", reason: "invalid", message: "generic reminder" },
    { action: "notify", reason: "too long", message: "x".repeat(501) },
  ])("rejects invalid structured output %#", async value => {
    await expect(decideFollowup({ kind: "unanswered_10m", history: [] }, client(value))).rejects.toThrow();
  });
});