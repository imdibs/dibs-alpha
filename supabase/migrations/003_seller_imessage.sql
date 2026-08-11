alter table messaging_sessions
  add column seller_draft jsonb,
  add column pending_listing_action jsonb,
  add column recent_owned_listing_ids uuid[] not null default '{}';

alter table messaging_sessions drop constraint if exists messaging_sessions_context_kind_check;
alter table messaging_sessions add constraint messaging_sessions_context_kind_check
  check (context_kind in ('search', 'chats', 'seller', 'listings'));

comment on column messaging_sessions.seller_draft is
  'Small, per-user iMessage listing draft. Contains confirmed fields and unpublished image storage paths/URLs.';
comment on column messaging_sessions.pending_listing_action is
  'Explicit-confirmation gate for publishing or changing an owned listing.';