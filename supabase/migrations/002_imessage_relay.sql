alter table users add column imessage_address text;
create unique index users_imessage_address_idx
  on users(imessage_address)
  where imessage_address is not null;

create table messaging_sessions (
  identity text primary key,
  user_id uuid unique references users(id) on delete set null,
  photon_space_id text,
  recent_listing_ids uuid[] not null default '{}',
  recent_conversation_ids uuid[] not null default '{}',
  context_kind text not null default 'search' check (context_kind in ('search', 'chats')),
  selected_listing_id uuid references listings(id) on delete set null,
  active_conversation_id uuid references conversations(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table photon_message_events (
  provider_message_id text primary key,
  photon_space_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  event_kind text not null check (event_kind in ('user_message', 'dibs_reply', 'dibs_relay', 'dibs_attachment')),
  normalized_identity text,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table messages alter column sender_id drop not null;
alter table messages add column message_kind text not null default 'participant'
  check (message_kind in ('participant', 'dibs_system', 'dibs_outbound'));
alter table messages add column participant_role text
  check (participant_role in ('buyer', 'seller'));
alter table messages add column transport_direction text
  check (transport_direction in ('inbound', 'outbound'));
alter table messages add column provider_message_id text;
alter table messages add column in_reply_to_message_id uuid references messages(id) on delete set null;
update messages
set participant_role = case
  when messages.sender_id = conversations.buyer_id then 'buyer'
  when messages.sender_id = conversations.seller_id then 'seller'
end
from conversations
where messages.conversation_id = conversations.id;
create unique index messages_provider_message_id_idx
  on messages(provider_message_id)
  where provider_message_id is not null;
alter table messages add constraint messages_sender_kind_check check (
  (message_kind = 'participant' and sender_id is not null and participant_role is not null)
  or (message_kind <> 'participant' and sender_id is null and participant_role is null)
);

alter table messaging_sessions enable row level security;
alter table photon_message_events enable row level security;

comment on column users.imessage_address is
  'Manually linked, normalized E.164 phone number or lowercase iMessage email. Never expose to another user.';
comment on column messages.body is
  'Exact participant text for participant rows; exact Dibs-rendered text for Dibs rows.';