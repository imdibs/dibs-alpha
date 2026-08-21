import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  host: "localhost:3000" as string | null,
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (name: string) => name === "host" ? mocks.host : null }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
import { requireLocalAdmin } from "./local-admin";

describe("local Mission Control boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "development");
    mocks.host = "localhost:3000";
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000"])("allows development requests for %s", async host => {
    mocks.host = host;
    await expect(requireLocalAdmin()).resolves.toBeUndefined();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it.each(["app.dibs.chat", "localhost.example.com", null])("returns 404 in development for non-local host %s", async host => {
    mocks.host = host;
    await expect(requireLocalAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("returns 404 in production even for localhost", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(requireLocalAdmin()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});