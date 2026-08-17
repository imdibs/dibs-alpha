import { describe, expect, it } from "vitest";
import { classifyDealSignal, matchingCounterpartyReport } from "./deal-signals";

describe("deal signal classification", () => {
  it.each(["interested", "how much?", "where are you?", "maybe", "let me think"])("does not classify weak evidence: %s", text => {
    expect(classifyDealSignal(text)).toBeNull();
  });

  it("classifies coordination as possible without claiming participant confirmation", () => {
    expect(classifyDealSignal("I'll take it, meet me at 6")).toMatchObject({ status: "possible", confidence: 0.55 });
  });

  it("keeps even strong conversational language at possible", () => {
    expect(classifyDealSignal("payment sent and I picked it up")).toMatchObject({ status: "possible", confidence: 0.7 });
    expect(classifyDealSignal("payment sent")).toMatchObject({ status: "possible" });
  });

  it("only matches an independent participant at the same reported price", () => {
    const reports = [{ reported_by: "buyer", evidence: { reportedPriceCents: 10000 } }, { reported_by: "seller", evidence: { reportedPriceCents: 9000 } }];
    expect(matchingCounterpartyReport(reports, "seller", 10000)?.reported_by).toBe("buyer");
    expect(matchingCounterpartyReport(reports, "seller", 11000)).toBeNull();
    expect(matchingCounterpartyReport([{ reported_by: "seller", evidence: { reportedPriceCents: 10000 } }], "seller", 10000)).toBeNull();
  });
});