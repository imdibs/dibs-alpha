import { describe, expect, it } from "vitest";
import { applySellerReply, applySellerText, isConfirmation, listingDescription, missingDraftField, missingDraftFields, parseCondition, parsePrice, parseSellTitle, reviewDraft, type SellerDraft } from "./seller-listing";

const empty = (): SellerDraft => ({ photos: [] });

describe("seller listing conversation", () => {
  it("extracts information already supplied in a sell request", () => {
    const draft = applySellerText(empty(), "I wanna sell my PS5 for $300");
    expect(draft).toMatchObject({ title: "PS5", priceCents: 30000 });
    expect(missingDraftField(draft)).toBe("category");
  });

  it.each([
    ["like new", "like_new"], ["good", "good"], ["fair condition", "fair"], ["brand new", "new"],
  ] as const)("normalizes %s condition", (text, expected) => expect(parseCondition(text)).toBe(expected));

  it("updates only corrected fields and keeps photos", () => {
    const draft: SellerDraft = { title: "PS5", condition: "like_new", priceCents: 30000, city: "Miami", photos: [{ id: "1", path: "p", url: "u" }] };
    expect(applySellerText(draft, "actually make it 275")).toMatchObject({ title: "PS5", condition: "like_new", priceCents: 27500, city: "Miami", photos: draft.photos });
    expect(applySellerText(draft, "call it PS5 Slim").title).toBe("PS5 Slim");
    expect(applySellerText(draft, "add that it comes with two controllers").description).toBe("it comes with two controllers");
  });

  it("does not accept invalid prices or broad confirmations", () => {
    expect(parsePrice("$0")).toBeUndefined();
    expect(parsePrice("maybe later")).toBeUndefined();
    expect(isConfirmation("yeah")).toBe(true);
    expect(isConfirmation("maybe")).toBe(false);
  });

  it("renders a concise complete review", () => {
    const text = reviewDraft({ title: "PS5 Slim", condition: "like_new", priceCents: 27500, city: "Miami, FL", age: "Bought 2 months ago", functionality: "Works perfectly", photos: [{ id: "1", path: "p", url: "u" }, { id: "2", path: "q", url: "v" }] });
    expect(text).toContain("PS5 Slim\n$275\nLike new\nBought 2 months ago\nWorks perfectly\nMiami, FL\n2 photos");
    expect(text).toContain("you good with me putting it up?");
  });

  it("collects direct title and city replies without treating a suggestion as confirmed", () => {
    const photoDraft: SellerDraft = { suggestedTitle: "PS5", photos: [{ id: "1", path: "p", url: "u" }] };
    expect(applySellerReply(photoDraft, "PS5").title).toBe("PS5");
    expect(photoDraft.title).toBeUndefined();
    const almostDone: SellerDraft = { title: "PS5", condition: "like_new", priceCents: 27500, photos: photoDraft.photos };
    expect(applySellerReply(almostDone, "Miami").city).toBe("Miami");
    expect(applySellerReply({ ...almostDone, city: "Miami" }, "actually I'm in Fort Lauderdale").city).toBe("Fort Lauderdale");
  });

  it("does not turn a generic sell request into a title", () => {
    expect(parseSellTitle("I wanna sell something")).toBeUndefined();
  });

  it("requires category-specific electronics details before publication", () => {
    const partial: SellerDraft = { title: "PS5 controller", category: "electronics", condition: "good", priceCents: 3000, city: "Miami", photos: [{ id: "1", path: "p", url: "u" }] };
    expect(missingDraftFields(partial)).toEqual(["age", "functionality", "defects", "includedItems", "packaging", "photos"]);
    expect(missingDraftFields({ ...partial, age: "2 months old", functionality: "Works properly", defects: "No scratches or drift", includedItems: "Controller and cable", packaging: "No box" })).toEqual(["photos"]);
  });

  it("does not require electronics questions for clothing and preserves seller facts for buyers", () => {
    const clothing: SellerDraft = { title: "Levi's 501 jeans", category: "clothing", size: "32x30", defects: "No damage", condition: "good", priceCents: 3000, city: "Miami", photos: [{ id: "1", path: "p", url: "u" }, { id: "2", path: "q", url: "v" }] };
    expect(missingDraftFields(clothing)).toEqual([]);
    expect(listingDescription({ ...clothing, age: "Bought last year", includedItems: "Jeans only" })).toBe("Bought last year No damage Jeans only 32x30");
  });
});