import { describe, expect, it } from "vitest";
import { SAFE_DIBS_FALLBACK, sanitizeIMessageText, sanitizeOutboundMessage } from "./imessage-text";

describe("iMessage text sanitization", () => {
  it("removes Markdown formatting and both long dash characters", () => {
    const input = "# Picks\n\n- **[ALPHA TEST] PS5 Digital Edition** — $265\n1. *Like new* – Miami\n`works great`";
    expect(sanitizeIMessageText(input)).toBe("Picks\n\nPS5 Digital Edition, $265\nLike new, Miami\nworks great");
  });

  it("preserves prices, URLs, line breaks, punctuation, underscores, and normal hyphens", () => {
    const input = "Sony WH-1000XM5\n$299.99, like-new\nhttps://dibs.chat/item_test?q=one-two";
    expect(sanitizeIMessageText(input)).toBe(input);
  });

  it("keeps intentional URLs while removing Markdown link syntax", () => {
    expect(sanitizeIMessageText("see [the listing](https://dibs.chat/items/1)."))
      .toBe("see the listing (https://dibs.chat/items/1).");
  });

  it("uses the safe fallback and removes duplicate text parts", () => {
    expect(sanitizeOutboundMessage({ text: "```\n```", parts: [
      { type: "text", text: "**same answer**" },
      { type: "text", text: "same answer" },
    ] })).toEqual({ text: SAFE_DIBS_FALLBACK, parts: [{ type: "text", text: "same answer" }] });
  });

  it("allows authoritative photo-only output without injecting fallback text", () => {
    expect(sanitizeOutboundMessage({ text: "more photos", parts: [
      { type: "image", imageUrl: "https://images.test/remaining.jpg" },
    ] })).toEqual({ text: "more photos", parts: [{ type: "image", imageUrl: "https://images.test/remaining.jpg" }] });
  });
});