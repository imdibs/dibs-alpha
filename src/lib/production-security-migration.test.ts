import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/010_web_listing_uploads_and_rate_limits.sql", import.meta.url), "utf8");
const expiredCleanupSql = sql.slice(
  sql.indexOf("create or replace function cleanup_expired_web_listing_uploads"),
  sql.indexOf("create or replace function complete_web_listing_upload_cleanup"),
);

describe("production security migration contract", () => {
  it("locks uploads to the listing bucket, owner prefix, MIME, size, expiry, and one-time consumption", () => {
    expect(sql).toContain("bucket_id text not null check (bucket_id = 'listing-images')");
    expect(sql).toContain("object_path = user_id::text || '/web-listing-uploads/' || id::text");
    expect(sql).toContain("upload.user_id = requested_user_id");
    expect(sql).toContain("object.bucket_id = upload.bucket_id and object.name = upload.object_path");
    expect(sql).toContain("object.metadata ->> 'mimetype'");
    expect(sql).toContain("object.metadata ->> 'size'");
    expect(sql).toContain("upload.expires_at > now() and upload.consumed_at is null and upload.cancelled_at is null");
    expect(sql).toContain("upload.cleanup_token is null");
    expect(sql).toContain("update web_listing_uploads set consumed_at = now()");
  });

  it("claims bounded cleanup work and safely defaults a NULL limit", () => {
    expect(sql).toContain("least(greatest(coalesce(requested_limit, 24), 1), 100)");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("limit bounded_limit");
    expect(sql).toContain("cleanup_claimed_at <= now() - interval '5 minutes'");
  });

  it("keeps cleanup rows until Storage succeeds and makes failed deletion retryable", () => {
    expect(expiredCleanupSql).not.toContain("delete from web_listing_uploads");
    expect(sql).toContain("complete_web_listing_upload_cleanup");
    expect(sql).toContain("release_web_listing_upload_cleanup");
    expect(sql).toContain("cleanup_token = null, cleanup_claimed_at = null");
  });

  it("never claims consumed uploads and scopes cancellation to the owner", () => {
    expect(sql).toContain("where user_id = requested_user_id and id = any(requested_upload_ids)");
    expect(sql).toMatch(/cancel_web_listing_uploads[\s\S]*?and consumed_at is null/);
    expect(sql).toMatch(/cleanup_expired_web_listing_uploads[\s\S]*?where consumed_at is null/);
  });

  it("serializes publication with cancellation and cleanup claims", () => {
    expect(sql).toContain("order by upload.id for update");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("upload.cleanup_token is null");
  });

  it("constructs public URLs in the RPC and never accepts image URLs", () => {
    expect(sql).toContain("'/storage/v1/object/public/listing-images/' || upload.object_path");
    expect(sql).not.toMatch(/requested_image_urls|requested_object_paths/);
  });

  it("uses atomic durable counters without storing raw addresses", () => {
    expect(sql).toContain("primary key (scope, key_hash)");
    expect(sql).toContain("on conflict (scope, key_hash) do update");
    expect(sql).toContain("key_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).not.toMatch(/ip_address|x-forwarded-for/);
  });

  it("makes every new RPC service-role only", () => {
    for (const fn of [
      "publish_web_listing(uuid, uuid[], text, text, integer, text, text, text)",
      "cancel_web_listing_uploads(uuid, uuid[])",
      "cleanup_expired_web_listing_uploads(integer)",
      "complete_web_listing_upload_cleanup(uuid[], uuid)",
      "release_web_listing_upload_cleanup(uuid[], uuid)",
      "check_rate_limit(text, text, integer, integer)",
    ]) {
      expect(sql).toContain(`revoke all on function ${fn} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function ${fn} to service_role;`);
    }
  });
});