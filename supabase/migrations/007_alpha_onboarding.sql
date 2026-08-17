create table alpha_onboardings (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique check (phone_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  user_id uuid not null unique references users(id) on delete cascade,
  city text not null default 'Miami' check (city = 'Miami'),
  cohort text not null default 'miami_alpha' check (cohort = 'miami_alpha'),
  source text not null check (source in ('direct', 'website', 'public_share', 'whatsapp', 'facebook', 'marketplace', 'referral', 'unknown')),
  visitor_id text check (visitor_id is null or char_length(visitor_id) between 16 and 100),
  attribution_token text check (attribution_token is null or char_length(attribution_token) between 16 and 100),
  originating_listing_id uuid references listings(id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'replied', 'failed')),
  submission_count integer not null default 1 check (submission_count >= 1),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  attempted_at timestamptz,
  sent_at timestamptz,
  replied_at timestamptz,
  completed_at timestamptz,
  photon_space_id text,
  provider_message_id text unique,
  failure_class text check (failure_class is null or failure_class in ('photon_unavailable', 'delivery_unknown')),
  retryable boolean not null default true,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state <> 'sent' or (sent_at is not null and provider_message_id is not null)),
  check (state <> 'replied' or replied_at is not null)
);
create index alpha_onboardings_queue_idx on alpha_onboardings(next_attempt_at, created_at) where state in ('pending', 'failed') and retryable;
alter table alpha_onboardings enable row level security;

create or replace function request_alpha_onboarding(
  requested_phone text,
  requested_source text,
  requested_visitor_id text default null,
  requested_attribution_token text default null,
  requested_originating_listing_id uuid default null
)
returns setof alpha_onboardings
language plpgsql
security invoker
set search_path = public
as $$
declare
  onboarding alpha_onboardings;
  alpha_user users;
begin
  perform pg_advisory_xact_lock(hashtextextended(requested_phone, 0));
  select * into onboarding from alpha_onboardings where phone_e164 = requested_phone;
  if found then
    update alpha_onboardings set
      submission_count = submission_count + 1,
      state = case when state = 'failed' and retryable then 'pending' else state end,
      failure_class = case when state = 'failed' and retryable then null else failure_class end,
      completed_at = case when state = 'failed' and retryable then null else completed_at end,
      next_attempt_at = case when state = 'failed' and retryable then now() else next_attempt_at end,
      updated_at = now()
    where id = onboarding.id returning * into onboarding;
    return next onboarding;
    return;
  end if;

  select * into alpha_user from users where imessage_address = requested_phone;
  if not found then
    insert into users (imessage_address, city, acquisition_source, originating_listing_id, acquisition_at)
    values (requested_phone, 'Miami', requested_source, requested_originating_listing_id, now())
    returning * into alpha_user;
  else
    update users set
      city = coalesce(city, 'Miami'),
      acquisition_source = coalesce(acquisition_source, requested_source),
      originating_listing_id = coalesce(originating_listing_id, requested_originating_listing_id),
      acquisition_at = coalesce(acquisition_at, now())
    where id = alpha_user.id returning * into alpha_user;
  end if;

  insert into alpha_onboardings (phone_e164, user_id, source, visitor_id, attribution_token, originating_listing_id)
  values (requested_phone, alpha_user.id, requested_source, requested_visitor_id, requested_attribution_token, requested_originating_listing_id)
  returning * into onboarding;
  return next onboarding;
end;
$$;

create or replace function claim_alpha_onboarding()
returns setof alpha_onboardings
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update alpha_onboardings set
    state = 'sending',
    attempt_count = attempt_count + 1,
    attempted_at = now(),
    completed_at = null,
    failure_class = null,
    updated_at = now()
  where id = (
    select id from alpha_onboardings
    where (state = 'pending' or (state = 'failed' and retryable)) and next_attempt_at <= now()
    order by next_attempt_at, created_at
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

grant select, insert, update, delete on table alpha_onboardings to service_role;
revoke all on function request_alpha_onboarding(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function claim_alpha_onboarding() from public, anon, authenticated;
grant execute on function request_alpha_onboarding(text, text, text, text, uuid) to service_role;
grant execute on function claim_alpha_onboarding() to service_role;

comment on table alpha_onboardings is 'Authoritative Miami Alpha join requests and first-message delivery state. Phone numbers are private service-role data.';
comment on column alpha_onboardings.failure_class is 'Coarse operational classification only. Never stores provider credentials or raw internal errors.';