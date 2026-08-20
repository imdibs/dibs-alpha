export type MarketplaceGroupSpace = {
  id: string;
  type: "dm" | "group";
  phone: string;
  send(text: string): Promise<{ id?: string; timestamp?: Date } | undefined>;
};

export type MarketplaceGroupProvider = {
  create(addresses: string[], options: { phone: string }): Promise<MarketplaceGroupSpace>;
  get(id: string, options: { phone: string }): Promise<MarketplaceGroupSpace>;
};

export type MarketplaceGroup = {
  providerSpaceId: string;
  providerLine: string;
  groupType: "group";
  participants: [string, string];
};

export class DedicatedIMessageLineRequiredError extends Error {
  constructor() {
    super("A dedicated PHOTON_IMESSAGE_LINE is required to create marketplace groups; shared mode is not supported.");
    this.name = "DedicatedIMessageLineRequiredError";
  }
}

export async function createDibsMarketplaceGroup(
  input: { buyerAddress: string; sellerAddress: string },
  dependencies: { provider: MarketplaceGroupProvider; configuredLine?: string },
): Promise<MarketplaceGroup> {
  const line = dependencies.configuredLine?.trim();
  if (!line) throw new DedicatedIMessageLineRequiredError();
  const participants: [string, string] = [input.buyerAddress, input.sellerAddress];
  const space = await dependencies.provider.create(participants, { phone: line });
  if (space.type !== "group" || space.phone !== line) throw new DedicatedIMessageLineRequiredError();
  return { providerSpaceId: space.id, providerLine: space.phone, groupType: "group", participants };
}