alter table photon_message_events
  add column occurred_at timestamptz not null default now();

comment on column photon_message_events.occurred_at is
  'Immutable provider event timestamp. Use for message ordering; completed_at is lifecycle telemetry only.';

create index photon_message_events_inbound_identity_time_idx
  on photon_message_events(normalized_identity, occurred_at)
  where direction = 'inbound' and event_kind = 'user_message';

create table notification_opportunities (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('unanswered_10m', 'final_24h')),
  stage smallint not null check (stage in (1, 2)),
  parent_opportunity_id uuid references notification_opportunities(id) on delete cascade,
  source_inbound_message_id text not null,
  source_outbound_message_id text not null,
  source_sent_at timestamptz not null,
  photon_space_id text not null,
  due_at timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled', 'evaluating', 'sending', 'sent', 'suppressed', 'cancelled', 'failed', 'delivery_unknown')),
  decision text check (decision is null or decision in ('notify', 'ignore')),
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 160),
  message_text text check (message_text is null or char_length(message_text) between 1 and 500),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  provider_message_id text unique,
  sent_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  failure_class text check (failure_class is null or failure_class in ('ai_unavailable', 'photon_unavailable', 'persistence_error', 'delivery_unknown')),
  retryable boolean not null default true,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'unanswered_10m' and stage = 1 and parent_opportunity_id is null)
    or (kind = 'final_24h' and stage = 2 and parent_opportunity_id is not null)
  ),
  check (state <> 'sent' or (provider_message_id is not null and sent_at is not null and completed_at is not null)),
  check (state <> 'cancelled' or (cancelled_at is not null and completed_at is not null)),
  check (state <> 'suppressed' or (decision = 'ignore' and completed_at is not null)),
  check (state <> 'delivery_unknown' or (failure_class = 'delivery_unknown' and not retryable and completed_at is not null)),
  check (state <> 'sending' or (decision = 'notify' and message_text is not null and claim_token is not null))
);

-- Photon provider message IDs are the canonical identity of actual outbound
-- Dibs messages. This partial index is the stage-one concurrency boundary.
create unique index notification_opportunities_10m_outbound_idx
  on notification_opportunities(source_outbound_message_id)
  where stage = 1;
-- Retain the inbound cause as a secondary guard: one inbound Dibs request
-- cannot accidentally fan out into multiple stage-one opportunities.
create unique index notification_opportunities_10m_inbound_idx
  on notification_opportunities(user_id, source_inbound_message_id)
  where stage = 1;
create unique index notification_opportunities_24h_parent_idx
  on notification_opportunities(parent_opportunity_id)
  where kind = 'final_24h';
create index notification_opportunities_queue_idx
  on notification_opportunities(next_attempt_at, due_at, created_at)
  where state in ('scheduled', 'failed') and retryable;
create index notification_opportunities_expired_claim_idx
  on notification_opportunities(claim_expires_at)
  where state = 'evaluating';
create index notification_opportunities_user_active_idx
  on notification_opportunities(user_id, source_sent_at)
  where state in ('scheduled', 'evaluating', 'failed');

alter table notification_opportunities enable row level security;

create or replace function validate_notification_stage_two_parent()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent notification_opportunities;
begin
  if new.stage <> 2 then return new; end if;

  select * into parent from notification_opportunities
  where id = new.parent_opportunity_id;
  if not found
    or parent.stage <> 1
    or parent.kind <> 'unanswered_10m'
    or parent.state <> 'sent'
    or parent.provider_message_id is null
    or parent.sent_at is null
    or parent.user_id <> new.user_id
    or parent.photon_space_id <> new.photon_space_id
    or new.source_outbound_message_id <> parent.provider_message_id
    or new.source_sent_at <> parent.sent_at
    or not exists (
      select 1 from photon_message_events event
      join users recipient on recipient.id = parent.user_id
      where event.provider_message_id = parent.provider_message_id
        and event.photon_space_id = parent.photon_space_id
        and event.direction = 'outbound'
        and event.event_kind = 'dibs_reply'
        and event.status = 'completed'
        and event.normalized_identity = recipient.imessage_address
        and event.occurred_at = parent.sent_at
    )
  then
    raise exception 'Stage two requires a matching confirmed sent stage-one parent.';
  end if;
  return new;
end;
$$;

create trigger notification_stage_two_parent_guard
before insert or update of stage, kind, parent_opportunity_id, user_id, photon_space_id,
  source_outbound_message_id, source_sent_at
on notification_opportunities
for each row execute function validate_notification_stage_two_parent();

create or replace function schedule_unanswered_followup(
  requested_user_id uuid,
  requested_source_inbound_message_id text,
  requested_source_outbound_message_id text
)
returns setof notification_opportunities
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_event photon_message_events;
  inbound_event photon_message_events;
  source_identity text;
  opportunity notification_opportunities;
begin
  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 0));

  select * into source_event
  from photon_message_events
  where provider_message_id = requested_source_outbound_message_id
    and direction = 'outbound'
    and event_kind = 'dibs_reply'
    and status = 'completed';
  if not found then raise exception 'Confirmed normal Dibs outbound event not found.'; end if;

  select imessage_address into source_identity from users where id = requested_user_id;
  if source_identity is null or source_identity <> source_event.normalized_identity then
    raise exception 'Outbound event recipient does not match user.';
  end if;

  select * into inbound_event
  from photon_message_events
  where provider_message_id = requested_source_inbound_message_id
    and photon_space_id = source_event.photon_space_id
    and direction = 'inbound'
    and event_kind = 'user_message'
    and status = 'completed'
    and normalized_identity = source_identity
    and occurred_at <= source_event.occurred_at;
  if not found then
    raise exception 'Matching completed source inbound event not found.';
  end if;

  insert into notification_opportunities (
    idempotency_key, user_id, kind, stage, source_inbound_message_id,
    source_outbound_message_id, source_sent_at, photon_space_id, due_at, next_attempt_at
  ) values (
    'unanswered_10m:' || requested_source_outbound_message_id,
    requested_user_id, 'unanswered_10m', 1, requested_source_inbound_message_id,
    requested_source_outbound_message_id, source_event.occurred_at,
    source_event.photon_space_id,
    source_event.occurred_at + interval '10 minutes',
    source_event.occurred_at + interval '10 minutes'
  ) on conflict do nothing;

  select * into opportunity from notification_opportunities
  where source_outbound_message_id = requested_source_outbound_message_id
    and stage = 1
  for update;

  if opportunity.state in ('scheduled', 'evaluating') or (opportunity.state = 'failed' and opportunity.retryable) then
    if exists (
      select 1 from photon_message_events event
      where event.direction = 'inbound'
        and event.event_kind = 'user_message'
        and event.normalized_identity = source_identity
        and event.occurred_at > opportunity.source_sent_at
    ) then
      update notification_opportunities set
        state = 'cancelled', decision_reason = 'reply recorded before scheduling',
        cancelled_at = now(), completed_at = now(), claim_token = null,
        claimed_at = null, claim_expires_at = null, updated_at = now()
      where id = opportunity.id returning * into opportunity;
    end if;
  end if;

  return next opportunity;
end;
$$;

create or replace function cancel_notification_followups(
  requested_user_id uuid,
  requested_inbound_message_id text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  cancelled_count integer;
  inbound_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(requested_user_id::text, 0));

  select event.occurred_at into inbound_at
  from photon_message_events event
  join users sender on sender.id = requested_user_id
  where event.provider_message_id = requested_inbound_message_id
    and event.direction = 'inbound'
    and event.event_kind = 'user_message'
    and event.normalized_identity = sender.imessage_address;
  if inbound_at is null then return 0; end if;

  update notification_opportunities set
    state = 'cancelled',
    decision_reason = left('reply:' || requested_inbound_message_id, 160),
    cancelled_at = inbound_at,
    completed_at = inbound_at,
    claim_token = null,
    claimed_at = null,
    claim_expires_at = null,
    updated_at = now()
  where user_id = requested_user_id
    and source_sent_at < inbound_at
    and (state in ('scheduled', 'evaluating') or (state = 'failed' and retryable));
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

create or replace function claim_notification_opportunity()
returns setof notification_opportunities
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- A worker may have died on either side of Photon submission. The outcome is
  -- ambiguous, so terminalize rather than ever risk an automatic duplicate.
  update notification_opportunities set
    state = 'delivery_unknown',
    failure_class = 'delivery_unknown',
    retryable = false,
    completed_at = now(),
    claim_token = null,
    claimed_at = null,
    claim_expires_at = null,
    updated_at = now()
  where state = 'sending' and claimed_at <= now() - interval '5 minutes';

  return query
  update notification_opportunities set
    state = 'evaluating',
    attempt_count = attempt_count + 1,
    claim_token = gen_random_uuid(),
    claimed_at = now(),
    claim_expires_at = now() + interval '2 minutes',
    completed_at = null,
    failure_class = null,
    updated_at = now()
  where id = (
    select id from notification_opportunities
    where (
      (state in ('scheduled', 'failed') and retryable and next_attempt_at <= now() and due_at <= now())
      or (state = 'evaluating' and claim_expires_at <= now())
    )
    order by due_at, created_at
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;

create or replace function begin_notification_delivery(
  requested_id uuid,
  requested_claim_token uuid,
  requested_message_text text,
  requested_reason text
)
returns setof notification_opportunities
language plpgsql
security invoker
set search_path = public
as $$
declare
  opportunity notification_opportunities;
  locked_user_id uuid;
begin
  select user_id into locked_user_id from notification_opportunities
  where id = requested_id;
  if locked_user_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(locked_user_id::text, 0));

  select * into opportunity from notification_opportunities
  where id = requested_id and state = 'evaluating' and claim_token = requested_claim_token
  for update;
  if not found then return; end if;

  if exists (
    select 1 from photon_message_events event
    join users recipient on recipient.id = opportunity.user_id
    where event.direction = 'inbound'
      and event.event_kind = 'user_message'
      and event.normalized_identity = recipient.imessage_address
      and event.occurred_at > opportunity.source_sent_at
  ) then
    update notification_opportunities set
      state = 'cancelled', decision_reason = 'reply detected before delivery',
      cancelled_at = now(), completed_at = now(), claim_token = null,
      claimed_at = null, claim_expires_at = null, updated_at = now()
    where id = requested_id returning * into opportunity;
  else
    update notification_opportunities set
      state = 'sending', decision = 'notify',
      decision_reason = left(requested_reason, 160),
      message_text = left(requested_message_text, 500), updated_at = now()
    where id = requested_id returning * into opportunity;
  end if;
  return next opportunity;
end;
$$;

create or replace function suppress_notification_opportunity(
  requested_id uuid,
  requested_claim_token uuid,
  requested_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare changed_id uuid;
begin
  update notification_opportunities set
    state = 'suppressed', decision = 'ignore', decision_reason = left(requested_reason, 160),
    completed_at = now(), claim_token = null, claimed_at = null, claim_expires_at = null, updated_at = now()
  where id = requested_id and state = 'evaluating' and claim_token = requested_claim_token
  returning id into changed_id;
  return changed_id is not null;
end;
$$;

create or replace function fail_notification_opportunity(
  requested_id uuid,
  requested_claim_token uuid,
  requested_failure_class text,
  requested_retryable boolean,
  requested_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare changed_id uuid;
begin
  if requested_failure_class not in ('ai_unavailable', 'photon_unavailable', 'persistence_error', 'delivery_unknown') then
    raise exception 'Invalid notification failure class.';
  end if;
  if requested_failure_class = 'delivery_unknown' and requested_retryable then
    raise exception 'Ambiguous delivery cannot be retried.';
  end if;

  update notification_opportunities set
    state = case when requested_failure_class = 'delivery_unknown' then 'delivery_unknown' else 'failed' end,
    failure_class = requested_failure_class,
    retryable = requested_retryable,
    next_attempt_at = requested_next_attempt_at,
    completed_at = case when requested_retryable then null else now() end,
    claim_token = null, claimed_at = null, claim_expires_at = null, updated_at = now()
  where id = requested_id
    and claim_token = requested_claim_token
    and state in ('evaluating', 'sending')
    and (state <> 'sending' or not requested_retryable)
  returning id into changed_id;
  return changed_id is not null;
end;
$$;

create or replace function complete_notification_delivery(
  requested_id uuid,
  requested_claim_token uuid,
  requested_provider_message_id text,
  requested_delivered_at timestamptz
)
returns setof notification_opportunities
language plpgsql
security invoker
set search_path = public
as $$
declare
  opportunity notification_opportunities;
  recipient_identity text;
  replied_at timestamptz;
  locked_user_id uuid;
begin
  select user_id into locked_user_id from notification_opportunities
  where id = requested_id;
  if locked_user_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(locked_user_id::text, 0));

  select * into opportunity from notification_opportunities
  where id = requested_id
  for update;
  if not found then return; end if;
  if opportunity.state = 'sent' and opportunity.provider_message_id = requested_provider_message_id then
    return next opportunity;
    return;
  end if;
  if opportunity.state <> 'sending' or opportunity.claim_token <> requested_claim_token then return; end if;
  if requested_delivered_at is null
    or requested_delivered_at < opportunity.claimed_at - interval '5 minutes'
    or requested_delivered_at > now() + interval '5 minutes'
  then
    raise exception 'Invalid Photon delivery timestamp.';
  end if;

  select imessage_address into recipient_identity from users where id = opportunity.user_id;
  if recipient_identity is null then raise exception 'Notification recipient not found.'; end if;

  insert into photon_message_events (
    provider_message_id, photon_space_id, direction, event_kind,
    normalized_identity, status, occurred_at, completed_at
  ) values (
    requested_provider_message_id, opportunity.photon_space_id, 'outbound', 'dibs_reply',
    recipient_identity, 'completed', requested_delivered_at, now()
  );

  update notification_opportunities set
    state = 'sent', provider_message_id = requested_provider_message_id,
    sent_at = requested_delivered_at, completed_at = now(), retryable = false,
    claim_token = null, claimed_at = null, claim_expires_at = null, updated_at = now()
  where id = requested_id returning * into opportunity;

  if opportunity.stage = 1 then
    select min(event.occurred_at) into replied_at
    from photon_message_events event
    where event.direction = 'inbound'
      and event.event_kind = 'user_message'
      and event.normalized_identity = recipient_identity
      and event.occurred_at > requested_delivered_at;

    insert into notification_opportunities (
      idempotency_key, user_id, kind, stage, parent_opportunity_id,
      source_inbound_message_id, source_outbound_message_id, source_sent_at,
      photon_space_id, due_at, next_attempt_at, state, decision_reason,
      cancelled_at, completed_at, retryable
    ) values (
      'final_24h:' || opportunity.id::text, opportunity.user_id, 'final_24h', 2, opportunity.id,
      opportunity.source_inbound_message_id, requested_provider_message_id, requested_delivered_at,
      opportunity.photon_space_id, requested_delivered_at + interval '24 hours', requested_delivered_at + interval '24 hours',
      case when replied_at is null then 'scheduled' else 'cancelled' end,
      case when replied_at is null then null else 'reply recorded before stage two creation' end,
      replied_at, replied_at, replied_at is null
    ) on conflict do nothing;
  end if;

  return next opportunity;
end;
$$;

grant select, insert, update, delete on table notification_opportunities to service_role;

revoke all on function schedule_unanswered_followup(uuid, text, text) from public, anon, authenticated;
revoke all on function cancel_notification_followups(uuid, text) from public, anon, authenticated;
revoke all on function claim_notification_opportunity() from public, anon, authenticated;
revoke all on function begin_notification_delivery(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function suppress_notification_opportunity(uuid, uuid, text) from public, anon, authenticated;
revoke all on function fail_notification_opportunity(uuid, uuid, text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function complete_notification_delivery(uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function schedule_unanswered_followup(uuid, text, text) to service_role;
grant execute on function cancel_notification_followups(uuid, text) to service_role;
grant execute on function claim_notification_opportunity() to service_role;
grant execute on function begin_notification_delivery(uuid, uuid, text, text) to service_role;
grant execute on function suppress_notification_opportunity(uuid, uuid, text) to service_role;
grant execute on function fail_notification_opportunity(uuid, uuid, text, boolean, timestamptz) to service_role;
grant execute on function complete_notification_delivery(uuid, uuid, text, timestamptz) to service_role;

comment on table notification_opportunities is
  'Durable, idempotent two-stage unanswered-conversation follow-ups. Never stores phone numbers or raw AI prompts.';