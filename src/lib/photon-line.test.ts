import { describe, expect, it } from "vitest";
import { isConfiguredPhotonIMessageLine, requirePhotonIMessageLine } from "./photon-line";

describe("Photon dedicated iMessage line configuration", () => {
  it("requires one E.164 dedicated line and trims environment whitespace", () => {
    expect(requirePhotonIMessageLine("  +13055550000  ")).toBe("+13055550000");
    expect(() => requirePhotonIMessageLine(undefined)).toThrow("PHOTON_IMESSAGE_LINE is required");
    expect(() => requirePhotonIMessageLine("305-555-0000")).toThrow("must be an E.164 phone number");
  });

  it("accepts inbound events only from the configured receiving line", () => {
    expect(isConfiguredPhotonIMessageLine("+13055550000", "+13055550000")).toBe(true);
    expect(isConfiguredPhotonIMessageLine("+13055559999", "+13055550000")).toBe(false);
    expect(isConfiguredPhotonIMessageLine(undefined, "+13055550000")).toBe(false);
  });
});