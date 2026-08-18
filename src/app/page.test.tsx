import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), PhoneFirstEntry: vi.fn(), Search: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/components/PhoneFirstEntry", () => ({ PhoneFirstEntry: mocks.PhoneFirstEntry }));
vi.mock("@/components/Search", () => ({ Search: mocks.Search }));
import Home from "./page";

describe("home entry experience", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders phone-first onboarding for an unauthenticated visitor", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await Home()).type).toBe(mocks.PhoneFirstEntry);
  });

  it("preserves the existing search UI for an authenticated user", async () => {
    mocks.currentUser.mockResolvedValue({ id: "user-1" });
    expect((await Home()).type).toBe(mocks.Search);
  });
});