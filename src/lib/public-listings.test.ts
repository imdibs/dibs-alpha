import { afterEach, describe, expect, it } from "vitest";
import { publicListingUrl } from "./public-listings";
import { publicTokenSchema } from "./validation";

describe("public listing URLs", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original; });

  it("builds a stable URL from an opaque token without exposing a listing UUID", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://dibs.chat/";
    const token = "7xK92pAb_Cde";
    expect(publicTokenSchema.parse(token)).toBe(token);
    expect(publicListingUrl(token)).toBe("https://dibs.chat/l/7xK92pAb_Cde");
    expect(publicListingUrl(token)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  it("rejects malformed public tokens", () => {
    expect(() => publicListingUrl("../../private")).toThrow();
  });
});