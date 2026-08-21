import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Mission Control server surface", () => {
  it("has no public admin analytics API endpoint", () => {
    expect(existsSync(new URL("../app/api/admin", import.meta.url))).toBe(false);
  });

  it("keeps analytics behind the guarded server page and service-role database client", () => {
    const analytics = readFileSync(new URL("./admin-analytics.ts", import.meta.url), "utf8");
    const database = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    const liveRefresh = readFileSync(new URL("../components/admin/LiveRefresh.tsx", import.meta.url), "utf8");
    expect(analytics).toContain('import { db } from "./db"');
    expect(database).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(analytics).not.toContain('"use client"');
    expect(liveRefresh).toContain("router.refresh()");
    expect(liveRefresh).not.toMatch(/admin-analytics|SUPABASE_SERVICE_ROLE_KEY|fetch\s*\(/);
  });
});