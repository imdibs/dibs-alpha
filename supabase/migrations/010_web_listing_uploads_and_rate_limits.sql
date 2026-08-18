-- Signed web uploads are authorized server-side, uploaded directly to Storage,
-- and consumed exactly once by an atomic listing publication transaction.
update storage.buckets set
  file_size_limit = 8000000,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
where id = 'listing-images';

create table web_listing_uploads (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  bucket_id text not null check (bucket_id = 'listing-images'),
  object_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes between 1 and 8000000),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  consumed_at timestamptz,
  cancelled_at timestamptz,
  cleanup_token uuid,
  cleanup_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (object_path = user_id::text || '/web-listing-uploads/' || id::text || case content_type
    when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp'
    when 'image/gif' then '.gif' when 'image/heic' then '.heic' when 'image/heif' then '.heif' end),
  check (not (consumed_at is not null and cancelled_at is not null)),
  check ((cleanup_token is null) = (cleanup_claimed_at is null))
);
create index web_listing_uploads_expiry_idx on web_listing_uploads(expires_at) where consumed_at is null;
alter table web_listing_uploads enable row level security;
grant select, insert, update, delete on table web_listing_uploads to service_role;

create or replace function publish_web_listing(
  requested_user_id uuid,
  requested_upload_ids uuid[],
  requested_title text,
  requested_description text,
  requested_price_cents integer,
  requested_condition text,
  requested_city text,
  requested_storage_origin text
)
returns setof listings
language plpgsql
security invoker
set search_path = public, storage
as $$
declare
  upload_count integer;
  valid_count integer;
  image_urls text[];
  created listings;
begin
  upload_count := coalesce(cardinality(requested_upload_ids), 0);
  if upload_count < 2 or upload_count > 6 or upload_count <> (select count(distinct requested_id) from unnest(requested_upload_ids) as requested_id) then
    raise exception 'Invalid upload authorization count.';
  end if;

  -- Serialize consumption and verify every authorization and exact Storage object.
  perform 1 from web_listing_uploads upload
    where upload.id = any(requested_upload_ids)
    order by upload.id for update;
  select count(*), array_agg(
    requested_storage_origin || '/storage/v1/object/public/listing-images/' || upload.object_path
    order by requested.ordinality
  ) into valid_count, image_urls
  from unnest(requested_upload_ids) with ordinality requested(id, ordinality)
  join web_listing_uploads upload on upload.id = requested.id
  join storage.objects object on object.bucket_id = upload.bucket_id and object.name = upload.object_path
  where upload.user_id = requested_user_id
    and upload.bucket_id = 'listing-images'
    and upload.object_path like requested_user_id::text || '/web-listing-uploads/%'
    and upload.expires_at > now() and upload.consumed_at is null and upload.cancelled_at is null and upload.cleanup_token is null
    and lower(coalesce(object.metadata ->> 'mimetype', '')) = upload.content_type
    and coalesce((object.metadata ->> 'size')::bigint, -1) = upload.size_bytes
    and coalesce((object.metadata ->> 'size')::bigint, -1) between 1 and 8000000;
  if valid_count <> upload_count then raise exception 'Upload authorization or object validation failed.'; end if;

  insert into listings (seller_id, title, description, price_cents, condition, city, image_urls, status, published_at)
  values (requested_user_id, requested_title, requested_description, requested_price_cents, requested_condition, requested_city, image_urls, 'active', now())
  returning * into created;
  update web_listing_uploads set consumed_at = now() where id = any(requested_upload_ids) and user_id = requested_user_id;
  return next created;
end;
$$;

create or replace function cancel_web_listing_uploads(requested_user_id uuid, requested_upload_ids uuid[])
returns table(upload_id uuid, object_path text, cleanup_token uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare claimed_token uuid := gen_random_uuid();
begin
  return query
  with candidates as (
    select id from web_listing_uploads
    where user_id = requested_user_id and id = any(requested_upload_ids)
      and consumed_at is null
      and (cleanup_token is null or cleanup_claimed_at <= now() - interval '5 minutes')
    order by id
    for update
  )
  update web_listing_uploads set
    cancelled_at = coalesce(cancelled_at, now()),
    cleanup_token = claimed_token,
    cleanup_claimed_at = now()
  from candidates
  where web_listing_uploads.id = candidates.id
  returning web_listing_uploads.id, web_listing_uploads.object_path, claimed_token;
end;
$$;

create or replace function cleanup_expired_web_listing_uploads(requested_limit integer default 24)
returns table(upload_id uuid, object_path text, cleanup_token uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed_token uuid := gen_random_uuid();
  bounded_limit integer := least(greatest(coalesce(requested_limit, 24), 1), 100);
begin
  return query
  with candidates as (
    select id from web_listing_uploads
    where consumed_at is null
      and (cancelled_at is not null or expires_at <= now() - interval '5 minutes')
      and (cleanup_token is null or cleanup_claimed_at <= now() - interval '5 minutes')
    order by coalesce(cancelled_at, expires_at), id
    for update skip locked
    limit bounded_limit
  )
  update web_listing_uploads upload set
    cleanup_token = claimed_token,
    cleanup_claimed_at = now()
  from candidates
  where upload.id = candidates.id
  returning upload.id, upload.object_path, claimed_token;
end;
$$;

create or replace function complete_web_listing_upload_cleanup(requested_upload_ids uuid[], requested_cleanup_token uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  with deleted as (
    delete from web_listing_uploads
    where id = any(requested_upload_ids) and cleanup_token = requested_cleanup_token and consumed_at is null
    returning id
  )
  select count(*)::integer from deleted;
$$;

create or replace function release_web_listing_upload_cleanup(requested_upload_ids uuid[], requested_cleanup_token uuid)
returns integer
language sql
security invoker
set search_path = public
as $$
  with released as (
    update web_listing_uploads set cleanup_token = null, cleanup_claimed_at = null
    where id = any(requested_upload_ids) and cleanup_token = requested_cleanup_token and consumed_at is null
    returning id
  )
  select count(*)::integer from released;
$$;

-- Durable fixed-window counters. Only HMAC identifiers are stored, never raw IPs.
create table rate_limit_counters (
  scope text not null check (scope in ('onboarding', 'public_event')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  request_count integer not null check (request_count > 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash)
);
create index rate_limit_counters_reset_idx on rate_limit_counters(reset_at);
alter table rate_limit_counters enable row level security;
grant select, insert, update, delete on table rate_limit_counters to service_role;

create or replace function check_rate_limit(requested_scope text, requested_key_hash text, requested_limit integer, requested_window_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare current_count integer;
begin
  if requested_scope not in ('onboarding', 'public_event') or requested_key_hash !~ '^[0-9a-f]{64}$'
    or requested_limit < 1 or requested_window_seconds < 1 or requested_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters.';
  end if;
  insert into rate_limit_counters (scope, key_hash, request_count, reset_at)
  values (requested_scope, requested_key_hash, 1, now() + make_interval(secs => requested_window_seconds))
  on conflict (scope, key_hash) do update set
    request_count = case when rate_limit_counters.reset_at <= now() then 1 else rate_limit_counters.request_count + 1 end,
    reset_at = case when rate_limit_counters.reset_at <= now() then now() + make_interval(secs => requested_window_seconds) else rate_limit_counters.reset_at end,
    updated_at = now()
  returning request_count into current_count;
  if random() < 0.01 then delete from rate_limit_counters where reset_at < now() - interval '1 day'; end if;
  return current_count > requested_limit;
end;
$$;

revoke all on function publish_web_listing(uuid, uuid[], text, text, integer, text, text, text) from public, anon, authenticated;
revoke all on function cancel_web_listing_uploads(uuid, uuid[]) from public, anon, authenticated;
revoke all on function cleanup_expired_web_listing_uploads(integer) from public, anon, authenticated;
revoke all on function complete_web_listing_upload_cleanup(uuid[], uuid) from public, anon, authenticated;
revoke all on function release_web_listing_upload_cleanup(uuid[], uuid) from public, anon, authenticated;
revoke all on function check_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function publish_web_listing(uuid, uuid[], text, text, integer, text, text, text) to service_role;
grant execute on function cancel_web_listing_uploads(uuid, uuid[]) to service_role;
grant execute on function cleanup_expired_web_listing_uploads(integer) to service_role;
grant execute on function complete_web_listing_upload_cleanup(uuid[], uuid) to service_role;
grant execute on function release_web_listing_upload_cleanup(uuid[], uuid) to service_role;
grant execute on function check_rate_limit(text, text, integer, integer) to service_role;

comment on table web_listing_uploads is 'Short-lived service-authorized web listing uploads; cleanup uses expiring claims so Storage deletion succeeds before authorization rows are deleted.';
comment on table rate_limit_counters is 'Durable server-side fixed-window counters keyed by HMAC identifiers; never stores raw IP addresses.';