import { describe, expect, it, vi } from "vitest";
import { createDibsMarketplaceGroup, DedicatedIMessageLineRequiredError } from "./marketplace-group";

describe("createDibsMarketplaceGroup", () => {
  it("creates a real group on the explicitly configured dedicated line", async () => {
    const create = vi.fn(async () => ({ id: "iMessage;+;stable-guid", type: "group" as const, phone: "+13055550000", send: vi.fn() }));
    const result = await createDibsMarketplaceGroup(
      { buyerAddress: "+13055550111", sellerAddress: "+13055550222" },
      { configuredLine: "+13055550000", provider: { create, get: vi.fn() } },
    );
    expect(create).toHaveBeenCalledWith(["+13055550111", "+13055550222"], { phone: "+13055550000" });
    expect(result).toEqual({
      providerSpaceId: "iMessage;+;stable-guid", providerLine: "+13055550000", groupType: "group",
      participants: ["+13055550111", "+13055550222"],
    });
  });

  it("rejects shared mode instead of selecting a line implicitly", async () => {
    await expect(createDibsMarketplaceGroup(
      { buyerAddress: "+13055550111", sellerAddress: "+13055550222" },
      { provider: { create: vi.fn(), get: vi.fn() } },
    )).rejects.toBeInstanceOf(DedicatedIMessageLineRequiredError);
  });

  it("rejects a provider response that is not a group", async () => {
    const provider = { create: vi.fn(async () => ({ id: "dm", type: "dm" as const, phone: "+13055550000", send: vi.fn() })), get: vi.fn() };
    await expect(createDibsMarketplaceGroup(
      { buyerAddress: "+13055550111", sellerAddress: "+13055550222" }, { provider, configuredLine: "+13055550000" },
    )).rejects.toBeInstanceOf(DedicatedIMessageLineRequiredError);
  });

  it("rejects a provider response from a different line", async () => {
    const provider = { create: vi.fn(async () => ({ id: "group", type: "group" as const, phone: "+13055559999", send: vi.fn() })), get: vi.fn() };
    await expect(createDibsMarketplaceGroup(
      { buyerAddress: "+13055550111", sellerAddress: "+13055550222" }, { provider, configuredLine: "+13055550000" },
    )).rejects.toBeInstanceOf(DedicatedIMessageLineRequiredError);
  });
});