-- Keep alpha_onboardings as the one-per-user historical first-onboarding
-- lifecycle. Every accepted website request is instead represented by an
-- append-only row in this delivery queue.
create table onboarding_message_requests (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  alpha_onboarding_id uuid not null references alpha_onboardings(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  source text not null check (source in ('direct', 'website', 'public_share', 'whatsapp', 'facebook', 'marketplace', 'referral', 'unknown')),
  visitor_id text check (visitor_id is null or char_length(visitor_id) between 16 and 100),
  attribution_token text check (attribution_token is null or char_length(attribution_token) between 16 and 100),
  originating_listing_id uuid references listings(id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'preparing', 'sending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  photon_space_id text,
  provider_message_id text unique,
  failure_class text check (failure_class is null or failure_class in ('photon_unavailable', 'preparation_timeout', 'persistence_error', 'delivery_unknown')),
  retryable boolean not null default true,
  updates_historical_onboarding boolean not null default false,
  created_user boolean not null default false,
  created_alpha_onboarding boolean not null default false,
  analytics_claimed_at timestamptz,
  attempted_at timestamptz,
  dispatch_started_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((claim_token is null and claimed_at is null and claim_expires_at is null) or (claim_token is not null and claimed_at is not null and claim_expires_at is not null)),
  check (state not in ('preparing', 'sending') or claim_token is not null),
  check (state <> 'sent' or (provider_message_id is not null and sent_at is not null and completed_at is not null and not retryable)),
  check (failure_class is distinct from 'delivery_unknown' or (state = 'failed' and not retryable and completed_at is not null)),
  check (state <> 'failed' or failure_class is not null),
  check (state not in ('sent', 'failed') or claim_token is null)
);

create index onboarding_message_requests_queue_idx
  on onboarding_message_requests(next_attempt_at, created_at)
  where state = 'pending' or (state = 'failed' and retryable);
create index onboarding_message_requests_preparing_lease_idx
  on onboarding_message_requests(claim_expires_at)
  where state = 'preparing';
create index onboarding_message_requests_sending_lease_idx
  on onboarding_message_requests(claim_expires_at)
  where state = 'sending';
create index onboarding_message_requests_user_time_idx
  on onboarding_message_requests(user_id, created_at desc);
create index onboarding_message_requests_onboarding_time_idx
  on onboarding_message_requests(alpha_onboarding_id, created_at desc);
alter table onboarding_message_requests enable row level security;

-- Recipient limiting uses the same durable counters but only ever receives an
-- application-generated HMAC. Raw phone numbers never enter this table.
alter table rate_limit_counters drop constraint rate_limit_counters_scope_check;
alter table rate_limit_counters add constraint rate_limit_counters_scope_check
  check (scope in ('onboarding', 'onboarding_recipient', 'public_event'));

create or replace function check_rate_limit(requested_scope text, requested_key_hash text, requested_limit integer, requested_window_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare current_count integer;
begin
  if requested_scope not in ('onboarding', 'onboarding_recipient', 'public_event') or requested_key_hash !~ '^[0-9a-f]{64}$'
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

create or replace function enqueue_onboarding_message_request(
  requested_id uuid,
  requested_phone text,
  requested_source text,
  requested_recipient_key_hash text,
  requested_visitor_id text default null,
  requested_attribution_token text default null,
  requested_originating_listing_id uuid default null
)
returns setof onboarding_message_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  message_request onboarding_message_requests;
  onboarding alpha_onboardings;
  alpha_user users;
  user_was_created boolean := false;
  onboarding_was_created boolean := false;
begin
  if requested_phone !~ '^\+[1-9][0-9]{7,14}$' or requested_recipient_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid onboarding request.';
  end if;

  -- This lock makes the idempotency lookup, recipient allowance, and insert a
  -- single serialized decision for this browser-generated request ID.
  perform pg_advisory_xact_lock(hashtextextended(requested_id::text, 0));
  select * into message_request from onboarding_message_requests where id = requested_id;
  if found then
    if message_request.phone_e164 <> requested_phone
      or message_request.source <> requested_source
      or message_request.visitor_id is distinct from requested_visitor_id
      or message_request.attribution_token is distinct from requested_attribution_token
      or message_request.originating_listing_id is distinct from requested_originating_listing_id then
      raise exception using errcode = 'P0001', message = 'onboarding_request_id_conflict';
    end if;
    return next message_request;
    return;
  end if;

  if check_rate_limit('onboarding_recipient', requested_recipient_key_hash, 5, 3600) then
    raise exception using errcode = 'P0001', message = 'onboarding_recipient_rate_limited';
  end if;

  -- Serialize identity creation against other onboarding submissions for the
  -- same normalized iMessage identity. The users unique index remains the
  -- ultimate identity invariant.
  perform pg_advisory_xact_lock(hashtextextended(requested_phone, 0));
  select * into alpha_user from users where imessage_address = requested_phone;
  if not found then
    insert into users (imessage_address, city, acquisition_source, originating_listing_id, acquisition_at)
    values (requested_phone, 'Miami', requested_source, requested_originating_listing_id, now())
    returning * into alpha_user;
    user_was_created := true;
  end if;

  select * into onboarding from alpha_onboardings where user_id = alpha_user.id;
  if not found then
    insert into alpha_onboardings (phone_e164, user_id, source, visitor_id, attribution_token, originating_listing_id)
    values (requested_phone, alpha_user.id, requested_source, requested_visitor_id, requested_attribution_token, requested_originating_listing_id)
    returning * into onboarding;
    onboarding_was_created := true;
  end if;

  insert into onboarding_message_requests (
    id, user_id, alpha_onboarding_id, phone_e164, source, visitor_id,
    attribution_token, originating_listing_id, updates_historical_onboarding,
    created_user, created_alpha_onboarding
  ) values (
    requested_id, alpha_user.id, onboarding.id, requested_phone, requested_source,
    requested_visitor_id, requested_attribution_token, requested_originating_listing_id,
    onboarding_was_created, user_was_created, onboarding_was_created
  ) returning * into message_request;

  return next message_request;
end;
$$;

create or replace function claim_onboarding_message_request()
returns setof onboarding_message_requests
language plpgsql
security invoker
set search_path = public
as $$
declare new_claim_token uuid := gen_random_uuid();
begin
  -- Preparation is pre-dispatch and safe to retry after a lost lease.
  update onboarding_message_requests request set
    state = 'failed', failure_class = 'preparation_timeout', retryable = true,
    next_attempt_at = now(), completed_at = now(), claim_token = null,
    claimed_at = null, claim_expires_at = null, updated_at = now()
  where request.state = 'preparing' and request.claim_expires_at <= now();

  -- Once dispatch started, Spectrum provides no idempotency key. A lost lease
  -- is delivery-ambiguous and must never be reclaimed automatically.
  with expired as (
    update onboarding_message_requests request set
      state = 'failed', failure_class = 'delivery_unknown', retryable = false,
      completed_at = now(), claim_token = null, claimed_at = null,
      claim_expires_at = null, updated_at = now()
    where request.state = 'sending' and request.claim_expires_at <= now()
    returning request.alpha_onboarding_id, request.updates_historical_onboarding
  )
  update alpha_onboardings onboarding set
    state = 'failed', failure_class = 'delivery_unknown', retryable = false,
    completed_at = now(), updated_at = now()
  from expired
  where expired.updates_historical_onboarding
    and onboarding.id = expired.alpha_onboarding_id and onboarding.state = 'sending';

  return query
  update onboarding_message_requests set
    state = 'preparing', attempt_count = attempt_count + 1,
    claim_token = new_claim_token, claimed_at = now(),
    claim_expires_at = now() + interval '5 minutes', attempted_at = now(),
    completed_at = null, failure_class = null, retryable = true, updated_at = now()
  where id = (
    select id from onboarding_message_requests
    where (state = 'pending' or (state = 'failed' and retryable)) and next_attempt_at <= now()
    order by next_attempt_at, created_at
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

create or replace function begin_onboarding_message_dispatch(requested_id uuid, requested_claim_token uuid, requested_photon_space_id text)
returns setof onboarding_message_requests
language plpgsql
security invoker
set search_path = public
as $$
declare
  message_request onboarding_message_requests;
  historical_rows_updated integer;
begin
  -- Replaying this transition with the same claim is safe and lets a worker
  -- reconcile a committed transition whose RPC response was lost.
  select * into message_request from onboarding_message_requests
  where id = requested_id and state = 'sending'
    and claim_token = requested_claim_token
    and photon_space_id = requested_photon_space_id
    and claim_expires_at > now();
  if found then
    return next message_request;
    return;
  end if;

  update onboarding_message_requests set
    state = 'sending', photon_space_id = requested_photon_space_id,
    dispatch_started_at = now(), claim_expires_at = now() + interval '5 minutes',
    updated_at = now()
  where id = requested_id and state = 'preparing' and claim_token = requested_claim_token
    and claim_expires_at > now()
  returning * into message_request;
  if not found then raise exception 'Onboarding message request is not dispatchable.'; end if;

  if message_request.updates_historical_onboarding then
    update alpha_onboardings set
      state = 'sending', attempt_count = message_request.attempt_count,
      attempted_at = now(), photon_space_id = requested_photon_space_id,
      failure_class = null, updated_at = now()
    where id = message_request.alpha_onboarding_id
      and (state = 'pending' or (state = 'failed' and retryable));
    get diagnostics historical_rows_updated = row_count;
    if historical_rows_updated <> 1 then
      raise exception 'Historical onboarding dispatch transition rejected.';
    end if;
  end if;
  return next message_request;
end;
$$;

create or replace function fail_onboarding_message_request(
  requested_id uuid,
  requested_claim_token uuid,
  requested_failure_class text,
  requested_retryable boolean,
  requested_next_attempt_at timestamptz default null
)
returns setof onboarding_message_requests
language plpgsql
security invoker
set search_path = public
as $$
declare message_request onboarding_message_requests;
begin
  if (requested_retryable and requested_failure_class not in ('photon_unavailable', 'preparation_timeout', 'persistence_error'))
    or (not requested_retryable and requested_failure_class <> 'delivery_unknown') then
    raise exception 'Invalid onboarding failure transition.';
  end if;

  update onboarding_message_requests set
    state = 'failed', failure_class = requested_failure_class,
    retryable = requested_retryable,
    next_attempt_at = case when requested_retryable then coalesce(requested_next_attempt_at, now() + interval '5 minutes') else next_attempt_at end,
    completed_at = now(), claim_token = null, claimed_at = null,
    claim_expires_at = null, updated_at = now()
  where id = requested_id and claim_token = requested_claim_token
    and ((state = 'preparing' and requested_retryable)
      or (state = 'sending' and not requested_retryable and requested_failure_class = 'delivery_unknown'))
  returning * into message_request;
  if not found then raise exception 'Onboarding message request failure transition rejected.'; end if;

  if message_request.updates_historical_onboarding then
    update alpha_onboardings set
      state = 'failed',
      failure_class = case when requested_retryable then 'photon_unavailable' else 'delivery_unknown' end,
      retryable = requested_retryable,
      next_attempt_at = case when requested_retryable then message_request.next_attempt_at else next_attempt_at end,
      completed_at = now(), updated_at = now()
    where id = message_request.alpha_onboarding_id
      and ((requested_retryable and state in ('pending', 'sending', 'failed'))
        or (not requested_retryable and state = 'sending'));
  end if;
  return next message_request;
end;
$$;

create or replace function complete_onboarding_message_request(
  requested_id uuid,
  requested_claim_token uuid,
  requested_provider_message_id text,
  requested_sent_at timestamptz
)
returns setof onboarding_message_requests
language plpgsql
security invoker
set search_path = public
as $$
declare message_request onboarding_message_requests;
begin
  update onboarding_message_requests set
    state = 'sent', provider_message_id = requested_provider_message_id,
    sent_at = requested_sent_at, completed_at = now(), retryable = false,
    failure_class = null, claim_token = null, claimed_at = null,
    claim_expires_at = null, updated_at = now()
  where id = requested_id and state = 'sending' and claim_token = requested_claim_token
  returning * into message_request;
  if not found then raise exception 'Onboarding message request completion rejected.'; end if;

  if message_request.updates_historical_onboarding then
    update alpha_onboardings set
      state = 'sent', photon_space_id = message_request.photon_space_id,
      provider_message_id = requested_provider_message_id, sent_at = requested_sent_at,
      completed_at = now(), failure_class = null, retryable = false, updated_at = now()
    where id = message_request.alpha_onboarding_id and state = 'sending';
  end if;
  return next message_request;
end;
$$;

create or replace function claim_onboarding_message_request_analytics(requested_id uuid)
returns boolean
language sql
security invoker
set search_path = public
as $$
  with claimed as (
    update onboarding_message_requests set analytics_claimed_at = now(), updated_at = now()
    where id = requested_id and analytics_claimed_at is null
    returning id
  ) select exists(select 1 from claimed);
$$;

-- Safely migrate only genuinely outstanding legacy work. Terminal sent and
-- replied history is intentionally excluded so old messages are never resent.
insert into onboarding_message_requests (
  id, user_id, alpha_onboarding_id, phone_e164, source, visitor_id,
  attribution_token, originating_listing_id, state, attempt_count,
  next_attempt_at, failure_class, retryable, updates_historical_onboarding,
  created_at, updated_at
)
select
  gen_random_uuid(), user_id, id, phone_e164, source, visitor_id,
  attribution_token, originating_listing_id,
  case when state = 'failed' then 'failed' else 'pending' end,
  attempt_count, next_attempt_at,
  case when state = 'failed' then 'photon_unavailable' else null end,
  retryable, true,
  created_at, updated_at
from alpha_onboardings
where state = 'pending' or (state = 'failed' and retryable);

grant select, insert, update, delete on table onboarding_message_requests to service_role;
-- Migration 011 is the queue cutover. Retiring both legacy entry points keeps
-- stale application/worker instances from creating or claiming a second copy
-- of work after the one-time backfill above.
revoke execute on function request_alpha_onboarding(text, text, text, text, uuid) from service_role;
revoke execute on function claim_alpha_onboarding() from service_role;
revoke all on function enqueue_onboarding_message_request(uuid, text, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function claim_onboarding_message_request() from public, anon, authenticated;
revoke all on function begin_onboarding_message_dispatch(uuid, uuid, text) from public, anon, authenticated;
revoke all on function fail_onboarding_message_request(uuid, uuid, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function complete_onboarding_message_request(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function claim_onboarding_message_request_analytics(uuid) from public, anon, authenticated;
grant execute on function enqueue_onboarding_message_request(uuid, text, text, text, text, text, uuid) to service_role;
grant execute on function claim_onboarding_message_request() to service_role;
grant execute on function begin_onboarding_message_dispatch(uuid, uuid, text) to service_role;
grant execute on function fail_onboarding_message_request(uuid, uuid, text, boolean, timestamptz) to service_role;
grant execute on function complete_onboarding_message_request(uuid, uuid, text, timestamptz) to service_role;
grant execute on function claim_onboarding_message_request_analytics(uuid) to service_role;

comment on table onboarding_message_requests is 'One durable outbound iMessage request per genuine website submission. Phone data is private service-role data; request ID is the idempotency key.';
comment on column onboarding_message_requests.updates_historical_onboarding is 'True only for the request responsible for the one-time alpha_onboardings lifecycle; repeat sends never overwrite history.';
comment on column onboarding_message_requests.failure_class is 'delivery_unknown means dispatch may have occurred and automatic retry is forbidden because Spectrum exposes no send idempotency key.';