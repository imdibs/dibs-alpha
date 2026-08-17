import { describe, expect, it } from "vitest";
import { normalizeE164Phone, normalizeUsPhone } from "./phone";

describe("phone normalization", () => {
  it.each(["+1 305 555 1234", "(305) 555-1234", "305-555-1234", "+13055551234"])("canonicalizes %s", value => {
    expect(normalizeUsPhone(value)).toBe("+13055551234");
  });

  it.each(["", "555-1234", "123-555-1234", "305-155-1234", "+44 20 7946 0958", "3055551234 ext 7", "x".repeat(33)])("rejects invalid public phone %s", value => {
    expect(normalizeUsPhone(value)).toBeNull();
  });

  it.each(["+919769760891", "+14155552671", "+447911123456"])("accepts canonical E.164 identity %s at the shared identity boundary", value => {
    expect(normalizeE164Phone(value)).toBe(value);
  });

  it.each([
    "+03055551234",
    "3055551234",
    "+44 7911 123456",
    "++447911123456",
    "+-447911123456",
    "+1234567",
    "+1234567890123456",
  ])("rejects non-canonical E.164 identity %s", value => {
    expect(normalizeE164Phone(value)).toBeNull();
  });
});