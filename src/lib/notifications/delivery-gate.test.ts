import { describe, expect, it, vi } from "vitest";
import { withNotificationDeliveryGate } from "./delivery-gate";

describe("notification delivery gate", () => {
  it("lets an already-received inbound record and cancel before final authorization", async () => {
    const order: string[] = [];
    let releaseInbound!: () => void;
    const inboundPaused = new Promise<void>(resolve => { releaseInbound = resolve; });

    const inbound = withNotificationDeliveryGate("space-1", async () => {
      order.push("inbound-recorded");
      await inboundPaused;
      order.push("followups-cancelled");
    });
    const authorizeAndSend = vi.fn(async () => {
      order.push("authorized");
      order.push("sent");
    });
    const notification = withNotificationDeliveryGate("space-1", authorizeAndSend);

    await Promise.resolve();
    expect(authorizeAndSend).not.toHaveBeenCalled();
    releaseInbound();
    await Promise.all([inbound, notification]);
    expect(order).toEqual(["inbound-recorded", "followups-cancelled", "authorized", "sent"]);
  });

  it("does not serialize unrelated Photon spaces", async () => {
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>(resolve => { releaseFirst = resolve; });
    const first = withNotificationDeliveryGate("space-1", () => firstPaused);
    const second = vi.fn(async () => undefined);
    await withNotificationDeliveryGate("space-2", second);
    expect(second).toHaveBeenCalledOnce();
    releaseFirst();
    await first;
  });
});