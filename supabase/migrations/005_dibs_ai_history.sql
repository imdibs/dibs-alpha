create table dibs_ai_turns (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  body text not null check (char_length(body) between 1 and 8000),
  provider_message_id text,
  created_at timestamptz not null default now()
);

create unique index dibs_ai_turns_provider_message_id_idx
  on dibs_ai_turns(provider_message_id)
  where provider_message_id is not null;
create index dibs_ai_turns_user_history_idx on dibs_ai_turns(user_id, created_at desc);
alter table dibs_ai_turns enable row level security;

comment on table dibs_ai_turns is
  'Bounded conversational memory for the Dibs AI. Never stores marketplace participant contact details.';

alter table messaging_sessions
  add column seller_draft_version integer not null default 0 check (seller_draft_version >= 0);