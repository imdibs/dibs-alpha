create or replace function generate_public_listing_token()
returns text
language sql
volatile
as $$
  select left(translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'), 12);
$$;

alter table listings
  add column public_token text,
  add column category text check (category in ('electronics', 'furniture', 'clothing', 'other')),
  add column published_at timestamptz,
  add column updated_at timestamptz not null default now(),
  add column sold_at timestamptz;

update listings
set public_token = generate_public_listing_token(),
    published_at = case when status <> 'draft' then created_at end,
    sold_at = case when status = 'sold' then coalesce(sold_at, created_at) end;

alter table listings
  alter column public_token set default generate_public_listing_token(),
  alter column public_token set not null,
  add constraint listings_public_token_format_check check (public_token ~ '^[A-Za-z0-9_-]{12}$');
create unique index listings_public_token_idx on listings(public_token);

create table product_events (
  id bigint generated always as identity primary key,
  event_name text not null check (char_length(event_name) between 3 and 80),
  occurred_at timestamptz not null default now(),
  user_id uuid references users(id) on delete set null,
  listing_id uuid references listings(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  visitor_id text check (visitor_id is null or char_length(visitor_id) between 16 and 100),
  attribution_token text check (attribution_token is null or char_length(attribution_token) between 16 and 100),
  source text check (source is null or char_length(source) between 1 and 100),
  metadata jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(metadata) = 'object')
);
create index product_events_name_time_idx on product_events(event_name, occurred_at desc);
create index product_events_listing_time_idx on product_events(listing_id, occurred_at desc) where listing_id is not null;
create index product_events_user_time_idx on product_events(user_id, occurred_at desc) where user_id is not null;
create index product_events_attribution_idx on product_events(attribution_token) where attribution_token is not null;
alter table product_events enable row level security;

alter table users
  add column activated_at timestamptz,
  add column acquisition_source text,
  add column originating_listing_id uuid references listings(id) on delete set null,
  add column acquisition_at timestamptz;

create table deal_signals (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  listing_id uuid not null references listings(id),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  status text not null check (status in ('possible', 'likely', 'confirmed')),
  source text not null check (source in ('buyer_report', 'seller_report', 'conversation_classification', 'listing_status', 'bilateral_confirmation')),
  reported_by uuid references users(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(evidence) = 'object')
);
create index deal_signals_conversation_time_idx on deal_signals(conversation_id, created_at desc);
create unique index deal_signals_participant_report_idx on deal_signals(conversation_id, reported_by) where source in ('buyer_report', 'seller_report');
create unique index deal_signals_confirmed_conversation_idx on deal_signals(conversation_id) where status = 'confirmed';
alter table deal_signals enable row level security;

-- Current Supabase projects do not auto-expose newly created public tables.
-- The application uses only the server-side service role for database access.
grant select, insert, update, delete on table
  users,
  listings,
  conversations,
  messages,
  deals,
  messaging_sessions,
  photon_message_events,
  dibs_ai_turns,
  product_events,
  deal_signals
to service_role;
grant usage, select on all sequences in schema public to service_role;

comment on column listings.public_token is 'Stable opaque identifier for public listing URLs. Never use it for authorization.';
comment on table product_events is 'First-party Alpha product and marketplace events. Metadata must not contain credentials or participant contact details.';
comment on table deal_signals is 'Auditable deal evidence. A signal is not a payment record and does not itself authorize listing mutations.';
comment on table deals is 'Canonical confirmed transactions. A row is created only after matching independent buyer and seller reports.';