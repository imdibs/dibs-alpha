import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), PhoneFirstOnboarding: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("./PhoneFirstOnboarding", () => ({ PhoneFirstOnboarding: mocks.PhoneFirstOnboarding }));
import { PhoneFirstEntry } from "./PhoneFirstEntry";

const visitorId = "550e8400-e29b-41d4-a716-446655440000";
const attributionId = "550e8400-e29b-41d4-a716-446655440001";
const listingToken = "7xK92pAb_Cde";

describe("PhoneFirstEntry attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const values: Record<string, string> = { dibs_visitor: visitorId, dibs_attribution: attributionId, dibs_origin_listing: listingToken };
    mocks.cookies.mockResolvedValue({ get: (name: string) => values[name] ? { value: values[name] } : undefined });
  });

  it("passes valid httpOnly tracking cookies into phone onboarding", async () => {
    const element = await PhoneFirstEntry();
    expect(element.type).toBe(mocks.PhoneFirstOnboarding);
    expect(element.props).toEqual({ visitorId, attributionId, originatingListing: listingToken });
  });
});