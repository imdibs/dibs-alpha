import { describe,expect,it } from "vitest";
import { parseSearchFallback } from "./search";
describe("parseSearchFallback",()=>{
  it("extracts the Alpha north-star request",()=>{expect(parseSearchFallback("Find me a used PS5 under $300 near Miami")).toEqual({query:"PS5",maxPriceCents:30000,city:"Miami"})});
  it("uses the user's city when none is stated",()=>{expect(parseSearchFallback("I want a camera", "Miami, FL")).toEqual({query:"I camera",city:"Miami, FL",maxPriceCents:undefined})});
  it("supports prices with commas",()=>{expect(parseSearchFallback("MacBook below $1,200", "Austin").maxPriceCents).toBe(120000)});
  it("treats near me as the supplied default city",()=>{expect(parseSearchFallback("Find me a PS5 under $300 near me", "Miami, FL")).toEqual({query:"PS5",maxPriceCents:30000,city:"Miami, FL"})});
});