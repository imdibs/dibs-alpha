import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("./auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
import { requireAdmin } from "./admin-auth";

const admin = { id: "123e4567-e89b-42d3-a456-426614174000", name: "Founder", email: "f@dibs.chat", city: "Miami" };

describe("admin authentication", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.ADMIN_USER_IDS = `  ${admin.id.toUpperCase()}  `; });
  afterEach(() => { delete process.env.ADMIN_USER_IDS; });

  it("returns an authenticated allowlisted user", async () => {
    mocks.currentUser.mockResolvedValue(admin);
    await expect(requireAdmin()).resolves.toEqual(admin);
  });

  it.each([null, { ...admin, id: "223e4567-e89b-42d3-a456-426614174000" }])("responds as not found for an unauthorized user", async user => {
    mocks.currentUser.mockResolvedValue(user);
    await expect(requireAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("fails loudly for a malformed allowlist", async () => {
    process.env.ADMIN_USER_IDS = "not-a-uuid";
    mocks.currentUser.mockResolvedValue(admin);
    await expect(requireAdmin()).rejects.toThrow("ADMIN_USER_IDS");
  });
});