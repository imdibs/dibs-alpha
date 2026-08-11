create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  city text not null check (char_length(city) between 1 and 100),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references users(id),
  title text not null check (char_length(title) between 3 and 120),
  description text not null check (char_length(description) between 3 and 2000),
  price_cents integer not null check (price_cents > 0),
  condition text not null check (condition in ('new', 'like_new', 'good', 'fair')),
  city text not null,
  image_urls text[] not null check (cardinality(image_urls) between 1 and 6),
  status text not null default 'active' check (status in ('draft', 'active', 'sold', 'removed')),
  search_document tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  created_at timestamptz not null default now()
);
create index listings_search_idx on listings using gin(search_document);
create index listings_active_city_idx on listings(lower(city), price_cents) where status = 'active';

create table conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique(listing_id, buyer_id),
  check (buyer_id <> seller_id)
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references users(id),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages(conversation_id, created_at);

create table deals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique references conversations(id),
  listing_id uuid not null references listings(id),
  buyer_id uuid not null references users(id),
  seller_id uuid not null references users(id),
  agreed_price_cents integer not null check (agreed_price_cents > 0),
  agreed_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do update set public = true;

-- The app uses the service key server-side. Do not expose it to the browser.
alter table users enable row level security;
alter table listings enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table deals enable row level security;