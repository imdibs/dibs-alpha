import { describe, expect, it } from "vitest";
import { deriveMarketplaceEvents } from "./marketplace-events";

describe("marketplace conversation intelligence", () => {
  it("detects offers and counteroffers with structured prices", () => {
    expect(deriveMarketplaceEvents("would you take $350?", "buyer")).toContainEqual(expect.objectContaining({ type: "offer_made", priceCents: 35000 }));
    expect(deriveMarketplaceEvents("375 is my lowest", "seller", { role: "buyer", priceCents: 35000 })).toContainEqual(expect.objectContaining({ type: "counter_offer", priceCents: 37500 }));
  });
  it("detects acceptance but keeps closing language as a probabilistic signal", () => {
    expect(deriveMarketplaceEvents("yeah $350 works", "seller", { role: "buyer", priceCents: 35000 })).toContainEqual(expect.objectContaining({ type: "offer_accepted", confidence: 0.88 }));
    expect(deriveMarketplaceEvents("payment received and they picked it up", "seller")).toContainEqual(expect.objectContaining({ type: "deal_likely_closed", confidence: 0.75 }));
  });
  it.each(["maybe", "let me think", "i might be able to", "is this available?"])("does not falsely close uncertain language: %s", text => {
    expect(deriveMarketplaceEvents(text, "buyer").some(event => event.type === "deal_likely_closed")).toBe(false);
  });
});