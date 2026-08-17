import { afterEach, describe, expect, it, vi } from "vitest";
import { recordPublicEvent } from "./PublicListingActions";

describe("public listing analytics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fails open when analytics rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(recordPublicEvent("listing_cta_clicked", "7xK92pAb_Cde", "marketplace")).resolves.toBeUndefined();
  });

  it("fails open for a non-success analytics response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(recordPublicEvent("listing_share_link_generated", "7xK92pAb_Cde", "public_share")).resolves.toBeUndefined();
  });
});