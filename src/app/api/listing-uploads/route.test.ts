import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), insert: vi.fn(), rpc: vi.fn(), sign: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/db", () => ({ db: () => ({
  from: () => ({ insert: mocks.insert }), rpc: mocks.rpc,
  storage: { from: () => ({ createSignedUploadUrl: mocks.sign, remove: mocks.remove }) },
}) }));
import { DELETE, POST } from "./route";

function request(method: string, body: unknown) { return new Request("https://app.dibs.chat/api/listing-uploads", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("listing upload authorizations", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.currentUser.mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440099" });
    mocks.insert.mockResolvedValue({ error: null }); mocks.rpc.mockResolvedValue({ data: [], error: null });
    mocks.sign.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://project.supabase.co/storage/v1/object/upload/sign/listing-images/${path}?token=signed` }, error: null }));
    mocks.remove.mockResolvedValue({ data: [], error: null });
  });

  it("authenticates first and creates only server-owned listing bucket paths", async () => {
    const response = await POST(request("POST", { files: [{ contentType: "image/jpeg", size: 100 }, { contentType: "image/png", size: 200 }] }));
    expect(response.status).toBe(200);
    const inserted = mocks.insert.mock.calls[0][0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ user_id: "550e8400-e29b-41d4-a716-446655440099", bucket_id: "listing-images", content_type: "image/jpeg", size_bytes: 100 });
    expect(inserted[0].object_path).toMatch(/^550e8400-e29b-41d4-a716-446655440099\/web-listing-uploads\/[0-9a-f-]+\.jpg$/);
  });

  it("rejects unsupported MIME types, oversized files, and invalid counts", async () => {
    for (const files of [[{ contentType: "image/svg+xml", size: 100 }, { contentType: "image/png", size: 100 }], [{ contentType: "image/jpeg", size: 8_000_001 }, { contentType: "image/png", size: 100 }], [{ contentType: "image/jpeg", size: 100 }]]) {
      expect((await POST(request("POST", { files }))).status).toBe(400);
    }
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("requires a Dibs session and cancellation is scoped to that user", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    expect((await POST(request("POST", { files: [] }))).status).toBe(401);
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect((await DELETE(request("DELETE", { uploadIds: [id] }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_web_listing_uploads", { requested_user_id: "550e8400-e29b-41d4-a716-446655440099", requested_upload_ids: [id] });
  });

  it("removes claimed expired objects before completing their database cleanup", async () => {
    const claim = { upload_id: "550e8400-e29b-41d4-a716-446655440001", object_path: "user/expired.jpg", cleanup_token: "550e8400-e29b-41d4-a716-446655440010" };
    mocks.rpc.mockImplementation(async (name: string) => name === "cleanup_expired_web_listing_uploads"
      ? { data: [claim], error: null }
      : { data: 1, error: null });
    expect((await POST(request("POST", { files: [{ contentType: "image/jpeg", size: 100 }, { contentType: "image/png", size: 200 }] }))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([claim.object_path]);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_web_listing_upload_cleanup", {
      requested_upload_ids: [claim.upload_id], requested_cleanup_token: claim.cleanup_token,
    });
    expect(mocks.rpc.mock.invocationCallOrder.find((_, index) => mocks.rpc.mock.calls[index][0] === "complete_web_listing_upload_cleanup"))
      .toBeGreaterThan(mocks.remove.mock.invocationCallOrder[0]);
  });

  it("releases a cleanup claim after Storage deletion fails and retries it later", async () => {
    const claim = { upload_id: "550e8400-e29b-41d4-a716-446655440002", object_path: "user/retry.jpg", cleanup_token: "550e8400-e29b-41d4-a716-446655440011" };
    mocks.rpc.mockImplementation(async (name: string) => name === "cleanup_expired_web_listing_uploads"
      ? { data: [claim], error: null }
      : { data: 1, error: null });
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } }).mockResolvedValueOnce({ data: [], error: null });
    const body = { files: [{ contentType: "image/jpeg", size: 100 }, { contentType: "image/png", size: 200 }] };
    expect((await POST(request("POST", body))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("release_web_listing_upload_cleanup", {
      requested_upload_ids: [claim.upload_id], requested_cleanup_token: claim.cleanup_token,
    });
    expect((await POST(request("POST", body))).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_web_listing_upload_cleanup", {
      requested_upload_ids: [claim.upload_id], requested_cleanup_token: claim.cleanup_token,
    });
  });

  it("keeps failed cancellation retryable and completes it after Storage recovers", async () => {
    const id = "550e8400-e29b-41d4-a716-446655440003";
    const token = "550e8400-e29b-41d4-a716-446655440012";
    mocks.rpc.mockImplementation(async (name: string) => name === "cancel_web_listing_uploads"
      ? { data: [{ upload_id: id, object_path: "user/cancel.jpg", cleanup_token: token }], error: null }
      : { data: 1, error: null });
    mocks.remove.mockResolvedValueOnce({ data: null, error: { message: "unavailable" } }).mockResolvedValueOnce({ data: [], error: null });
    expect((await DELETE(request("DELETE", { uploadIds: [id] }))).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledWith("release_web_listing_upload_cleanup", { requested_upload_ids: [id], requested_cleanup_token: token });
    expect((await DELETE(request("DELETE", { uploadIds: [id] }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("complete_web_listing_upload_cleanup", { requested_upload_ids: [id], requested_cleanup_token: token });
  });
});