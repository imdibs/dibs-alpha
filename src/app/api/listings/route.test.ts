import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), rpc: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/posthog", () => ({ capturePostHog: mocks.capture }));
import { POST } from "./route";

const first = "550e8400-e29b-41d4-a716-446655440000";
const second = "550e8400-e29b-41d4-a716-446655440001";
const valid = { title: "PS5 Slim", description: "Works perfectly", price: 275, condition: "good", city: "Miami", uploadIds: [first, second] };
function request(body: unknown) { return new Request("https://app.dibs.chat/api/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("POST /api/listings", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    mocks.currentUser.mockResolvedValue({ id: "user-1" });
    mocks.rpc.mockResolvedValue({ data: [{ id: "listing-1", public_token: "7xK92pAb_Cde" }], error: null });
  });

  it("publishes only authorization IDs and listing metadata through the ownership-checking RPC", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "listing-1", publicToken: "7xK92pAb_Cde" });
    expect(mocks.rpc).toHaveBeenCalledWith("publish_web_listing", expect.objectContaining({ requested_user_id: "user-1", requested_upload_ids: [first, second], requested_storage_origin: "https://project.supabase.co" }));
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ event: "listing_created" }));
  });

  it("rejects arbitrary image URLs and paths instead of accepting browser-selected objects", async () => {
    expect((await POST(request({ ...valid, imageUrls: ["https://evil.test/image.jpg"] }))).status).toBe(400);
    expect((await POST(request({ ...valid, objectPaths: ["other-user/private.jpg"] }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate upload authorization IDs before publication", async () => {
    expect((await POST(request({ ...valid, uploadIds: [first, first] }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires authentication and reports invalid or expired authorization failures", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    expect((await POST(request(valid))).status).toBe(401);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    expect((await POST(request(valid))).status).toBe(400);
  });
});