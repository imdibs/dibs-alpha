import { afterEach, describe, expect, it } from "vitest";
import { publicListingUrl } from "./public-listings";
import { publicTokenSchema } from "./validation";

describe("public listing URLs", () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it("builds a stable URL from an opaque token without exposing a listing UUID", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test/";
    const token = "7xK92pAb_Cde";
    expect(publicTokenSchema.parse(token)).toBe(token);
    expect(publicListingUrl(token)).toBe("https://staging.example.test/l/7xK92pAb_Cde");
    expect(publicListingUrl(token)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  });

  it("rejects malformed public tokens", () => {
    expect(() => publicListingUrl("../../private")).toThrow();
  });

  it("requires an explicitly configured site origin", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(() => publicListingUrl("7xK92pAb_Cde")).toThrow("NEXT_PUBLIC_SITE_URL must be configured as an HTTP(S) origin");
  });

  it("rejects a configured URL that is not an origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.example.test/app";
    expect(() => publicListingUrl("7xK92pAb_Cde")).toThrow("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin");
  });
});