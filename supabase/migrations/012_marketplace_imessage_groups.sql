-- Additive only: existing private-relay conversations and session pointers remain intact.
alter table conversations
  add column provider_space_id text,
  add column provider_line text,
  add column provider_group_type text,
  add column buyer_provider_identity text,
  add column seller_provider_identity text,
  add column connection_status text not null default 'relay',
  add column provider_creation_key uuid,
  add column provider_introduction_message_id text,
  add column connected_at timestamptz,
  add column completed_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table conversations add constraint conversations_connection_status_check check (
  connection_status in ('relay', 'group_pending', 'group_creating', 'group_created', 'introduction_sending', 'connected', 'completed', 'reconciliation_required', 'failed')
);
alter table conversations add constraint conversations_provider_group_type_check
  check (provider_group_type is null or provider_group_type = 'group');
alter table conversations add constraint conversations_provider_group_fields_check check (
  (provider_space_id is null and provider_line is null and provider_group_type is null)
  or (provider_space_id is not null and provider_line is not null and provider_group_type = 'group')
);
alter table conversations add constraint conversations_provider_participants_check check (
  (buyer_provider_identity is null and seller_provider_identity is null)
  or (buyer_provider_identity is not null and seller_provider_identity is not null and buyer_provider_identity <> seller_provider_identity)
);
create unique index conversations_provider_group_idx
  on conversations(provider_line, provider_space_id)
  where provider_space_id is not null;
create unique index conversations_provider_creation_key_idx
  on conversations(provider_creation_key)
  where provider_creation_key is not null;

create table marketplace_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  listing_id uuid not null references listings(id),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  source_message_id uuid references messages(id) on delete set null,
  event_type text not null check (event_type in ('seller_responded', 'buyer_responded', 'offer_made', 'counter_offer', 'offer_accepted', 'offer_rejected', 'deal_likely_closed', 'deal_failed', 'conversation_stalled')),
  price_cents integer check (price_cents is null or price_cents > 0),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  source text not null,
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index marketplace_events_message_type_idx
  on marketplace_events(source_message_id, event_type)
  where source_message_id is not null;
create index marketplace_events_conversation_time_idx
  on marketplace_events(conversation_id, occurred_at);
alter table marketplace_events enable row level security;

grant select, insert, update, delete on table marketplace_events to service_role;
grant usage, select on sequence marketplace_events_id_seq to service_role;

comment on column conversations.provider_creation_key is
  'Durable attempt marker written before provider creation. Ambiguous attempts require reconciliation and must never blindly create another group.';
comment on table marketplace_events is
  'Meaningful observed or derived marketplace facts. deal_likely_closed is probabilistic and is not transaction confirmation.';