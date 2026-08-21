import { describe, expect, it } from "vitest";
import { deriveMarketplaceEvents } from "./marketplace-events";

describe("marketplace conversation intelligence", () => {
  it("detects offers and counteroffers with structured prices", () => {
    expect(deriveMarketplaceEvents("would you take $350?", "buyer")).toContainEqual(expect.objectContaining({ type: "offer_made", priceCents: 35000 }));
    expect(deriveMarketplaceEvents("375 is my lowest", "seller", { role: "buyer", priceCents: 35000 })).toContainEqual(expect.objectContaining({ type: "counter_offer", priceCents: 37500 }));
  });
  it("detects acceptance but keeps closing language as a probabilistic signal", () => {
    expect(deriveMarketplaceEvents("yes, $350 works", "seller", { role: "buyer", priceCents: 35000 })).toContainEqual(expect.objectContaining({ type: "offer_accepted", confidence: 0.95 }));
    expect(deriveMarketplaceEvents("payment received and they picked it up", "seller")).toContainEqual(expect.objectContaining({ type: "deal_likely_closed", confidence: 0.75 }));
  });
  it.each(["sounds good", "sounds great", "yes", "deal", "perfect"])("requires opposite-party offer context before accepting: %s", text => {
    expect(deriveMarketplaceEvents(text, "seller").some(event => event.type === "offer_accepted")).toBe(false);
    expect(deriveMarketplaceEvents(text, "seller", { role: "buyer", priceCents: 3500 }).map(event => event.type)).toEqual(expect.arrayContaining(["offer_accepted", "deal_likely_closed"]));
  });
  it("recognizes the production-regression offer wording", () => {
    expect(deriveMarketplaceEvents("Let's close at $35?", "buyer")).toContainEqual(expect.objectContaining({ type: "offer_made", priceCents: 3500 }));
  });
  it.each(["maybe", "let me think", "i might be able to", "is this available?"])("does not falsely close uncertain language: %s", text => {
    expect(deriveMarketplaceEvents(text, "buyer").some(event => event.type === "deal_likely_closed")).toBe(false);
  });
});