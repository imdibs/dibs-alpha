-- Preserve the existing one-deal-per-conversation model while making the
-- confirmation path auditable for both participant reports and strong group agreements.
alter table deals
  add column source text not null default 'participant_bilateral_reports',
  add column trigger_message_id uuid references messages(id) on delete set null,
  add column confidence numeric(4,3) not null default 1 check (confidence between 0 and 1),
  add constraint deals_source_check check (source in ('participant_bilateral_reports', 'conversation_bilateral_agreement'));

comment on table deals is
  'Canonical transactions confirmed by matching participant reports or high-confidence bilateral agreement in a connected marketplace group. One row is allowed per conversation.';

create or replace function confirm_marketplace_group_deal(
  requested_conversation_id uuid,
  requested_listing_id uuid,
  requested_buyer_id uuid,
  requested_seller_id uuid,
  requested_price_cents integer,
  requested_agreed_at timestamptz,
  requested_offer_message_id uuid,
  requested_acceptance_message_id uuid,
  requested_confidence numeric
) returns void
language plpgsql
set search_path = public
as $$
begin
  if requested_price_cents <= 0 or requested_confidence < 0.95 or requested_confidence > 1 then
    raise exception 'invalid marketplace agreement';
  end if;

  if not exists (
    select 1 from conversations
    where id = requested_conversation_id
      and listing_id = requested_listing_id
      and buyer_id = requested_buyer_id
      and seller_id = requested_seller_id
      and connection_status in ('connected', 'completed')
      and provider_group_type = 'group'
      and provider_space_id is not null
      and provider_line is not null
      and buyer_provider_identity is not null
      and seller_provider_identity is not null
      and provider_introduction_message_id is not null
      and connected_at is not null
  ) then
    raise exception 'conversation is not a completed marketplace introduction';
  end if;

  insert into deals (
    conversation_id, listing_id, buyer_id, seller_id, agreed_price_cents,
    agreed_at, source, trigger_message_id, confidence
  ) values (
    requested_conversation_id, requested_listing_id, requested_buyer_id, requested_seller_id,
    requested_price_cents, requested_agreed_at, 'conversation_bilateral_agreement',
    requested_acceptance_message_id, requested_confidence
  ) on conflict (conversation_id) do nothing;

  insert into deal_signals (
    conversation_id, listing_id, buyer_id, seller_id, status, source,
    reported_by, confidence, evidence
  ) values (
    requested_conversation_id, requested_listing_id, requested_buyer_id, requested_seller_id,
    'confirmed', 'bilateral_confirmation', null, requested_confidence,
    jsonb_build_object(
      'offerMessageId', requested_offer_message_id,
      'acceptanceMessageId', requested_acceptance_message_id,
      'agreedPriceCents', requested_price_cents,
      'trigger', 'conversation_bilateral_agreement'
    )
  ) on conflict do nothing;
end;
$$;

revoke all on function confirm_marketplace_group_deal(uuid, uuid, uuid, uuid, integer, timestamptz, uuid, uuid, numeric) from public;
grant execute on function confirm_marketplace_group_deal(uuid, uuid, uuid, uuid, integer, timestamptz, uuid, uuid, numeric) to service_role;