-- Founder analytics are aggregated in PostgreSQL and exposed only to the server-side service role.
create index if not exists users_created_at_idx on users(created_at);
create index if not exists listings_created_at_idx on listings(created_at);
create index if not exists listings_published_at_idx on listings(published_at) where published_at is not null;
create index if not exists conversations_created_at_idx on conversations(created_at);
create index if not exists conversations_connected_at_idx on conversations(connected_at) where connected_at is not null;
create index if not exists deals_agreed_at_idx on deals(agreed_at);

create or replace function admin_analytics_bounds(requested_range text, requested_now timestamptz default now())
returns table(range_start timestamptz, range_end timestamptz, previous_start timestamptz)
language plpgsql stable
set search_path = public
as $$
declare local_today date := (requested_now at time zone 'America/New_York')::date;
begin
  if requested_range = 'today' then
    range_start := local_today::timestamp at time zone 'America/New_York';
    range_end := (local_today + 1)::timestamp at time zone 'America/New_York';
    previous_start := (local_today - 1)::timestamp at time zone 'America/New_York';
  elsif requested_range = '7d' then
    range_start := (local_today - 6)::timestamp at time zone 'America/New_York';
    range_end := (local_today + 1)::timestamp at time zone 'America/New_York';
    previous_start := (local_today - 13)::timestamp at time zone 'America/New_York';
  elsif requested_range = '30d' then
    range_start := (local_today - 29)::timestamp at time zone 'America/New_York';
    range_end := (local_today + 1)::timestamp at time zone 'America/New_York';
    previous_start := (local_today - 59)::timestamp at time zone 'America/New_York';
  elsif requested_range = 'all' then
    range_start := '-infinity'::timestamptz;
    range_end := (local_today + 1)::timestamp at time zone 'America/New_York';
    previous_start := null;
  else
    raise exception 'unsupported analytics range';
  end if;
  return next;
end;
$$;

create or replace function admin_marketplace_overview(requested_range text)
returns jsonb language sql stable security definer set search_path = public as $$
with bounds as (select * from admin_analytics_bounds(requested_range)),
facts as (
  select 'users' metric, u.created_at occurred_at, 0::bigint amount from users u
  union all select 'listings', l.created_at, 0 from listings l
  union all select 'active_listings', l.published_at, 0 from listings l where l.status = 'active' and l.published_at is not null
  union all select 'conversations', c.created_at, 0 from conversations c
  union all select 'introductions', c.connected_at, 0 from conversations c
    where c.connection_status in ('connected', 'completed') and c.provider_group_type = 'group'
      and c.provider_space_id is not null and c.provider_line is not null
      and c.buyer_provider_identity is not null and c.seller_provider_identity is not null
      and c.provider_introduction_message_id is not null and c.connected_at is not null
  union all select 'deals', d.agreed_at, d.agreed_price_cents::bigint from deals d
), metrics(metric) as (values ('users'), ('listings'), ('active_listings'), ('conversations'), ('introductions'), ('deals'), ('gmv')),
aggregated as (
  select m.metric,
    case when m.metric = 'gmv' then coalesce(sum(f.amount) filter (where f.metric = 'deals'), 0)
      else count(*) filter (where f.metric = m.metric) end::bigint value,
    case when m.metric = 'gmv' then coalesce(sum(f.amount) filter (where f.metric = 'deals' and f.occurred_at >= b.range_start and f.occurred_at < b.range_end), 0)
      else count(*) filter (where f.metric = m.metric and f.occurred_at >= b.range_start and f.occurred_at < b.range_end) end::bigint period_count,
    case when requested_range = 'all' then null
      when m.metric = 'gmv' then coalesce(sum(f.amount) filter (where f.metric = 'deals' and f.occurred_at >= b.previous_start and f.occurred_at < b.range_start), 0)
      else count(*) filter (where f.metric = m.metric and f.occurred_at >= b.previous_start and f.occurred_at < b.range_start) end::bigint previous_count
  from metrics m cross join bounds b left join facts f on true group by m.metric, b.range_start, b.range_end, b.previous_start
)
select jsonb_object_agg(metric, jsonb_build_object(
  'value', value, 'periodCount', period_count, 'previousCount', previous_count,
  'change', case when previous_count is null then null else period_count - previous_count end,
  'changePercent', case when previous_count is null then null when previous_count = 0 then case when period_count = 0 then 0 else null end
    else round(((period_count - previous_count)::numeric / previous_count) * 100, 1) end
)) from aggregated;
$$;

create or replace function admin_marketplace_funnel(requested_range text)
returns jsonb language sql stable security definer set search_path = public as $$
with bounds as (select * from admin_analytics_bounds(requested_range)),
cohort as (select u.id from users u cross join bounds b where u.created_at >= b.range_start and u.created_at < b.range_end),
stages as (
  select 1 ordinal, 'Users' label, count(*)::bigint count from cohort
  union all select 2, 'Created listings', count(distinct c.id) from cohort c join listings l on l.seller_id = c.id cross join bounds b where l.created_at < b.range_end
  union all select 3, 'Published listings', count(distinct c.id) from cohort c join listings l on l.seller_id = c.id cross join bounds b where l.published_at is not null and l.published_at < b.range_end
  union all select 4, 'Buyer conversations', count(distinct c.id) from cohort c join conversations x on x.buyer_id = c.id cross join bounds b where x.created_at < b.range_end
  union all select 5, 'Provider connections', count(distinct c.id) from cohort c join conversations x on x.buyer_id = c.id cross join bounds b
    where x.provider_group_type = 'group' and x.provider_space_id is not null and x.provider_line is not null
      and x.buyer_provider_identity is not null and x.seller_provider_identity is not null and x.created_at < b.range_end
  union all select 6, 'Verified introductions', count(distinct c.id) from cohort c join conversations x on x.buyer_id = c.id cross join bounds b
    where x.connection_status in ('connected', 'completed') and x.provider_group_type = 'group'
      and x.provider_space_id is not null and x.provider_line is not null
      and x.buyer_provider_identity is not null and x.seller_provider_identity is not null
      and x.provider_introduction_message_id is not null and x.connected_at is not null and x.connected_at < b.range_end
  union all select 7, 'Buyer deals', count(distinct c.id) from cohort c join deals d on d.buyer_id = c.id cross join bounds b where d.agreed_at < b.range_end
), total as (select count(*)::numeric value from cohort)
select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', count,
  'conversionPercent', case when total.value = 0 then 0 else round(count::numeric / total.value * 100, 1) end) order by ordinal), '[]'::jsonb)
from stages cross join total;
$$;

create or replace function admin_supply_analytics()
returns jsonb language sql stable security definer set search_path = public as $$
select jsonb_build_object(
  'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', count) order by count desc, label), '[]'::jsonb) from
    (select coalesce(category, 'Uncategorized') label, count(*)::bigint count from listings group by 1) x),
  'byLocation', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', count) order by count desc, label), '[]'::jsonb) from
    (select city label, count(*)::bigint count from listings group by city) x),
  'byStatus', (select jsonb_agg(jsonb_build_object('label', status, 'count', count) order by ordinal) from
    (select s.status, s.ordinal, count(l.id)::bigint count from (values ('active', 1), ('draft', 2), ('sold', 3), ('removed', 4)) s(status, ordinal)
      left join listings l on l.status = s.status group by s.status, s.ordinal) x),
  'newestListings', (select coalesce(jsonb_agg(to_jsonb(x) order by x."createdAt" desc), '[]'::jsonb) from
    (select l.title, l.price_cents as "priceCents", coalesce(l.category, 'Uncategorized') category, l.city location, l.created_at as "createdAt"
      from listings l order by l.created_at desc limit 10) x)
);
$$;

create or replace function admin_deal_analytics(requested_range text)
returns jsonb language sql stable security definer set search_path = public as $$
with bounds as (select * from admin_analytics_bounds(requested_range)),
selected_deals as (select d.* from deals d cross join bounds b where d.agreed_at >= b.range_start and d.agreed_at < b.range_end),
selected_introductions as (select c.* from conversations c cross join bounds b where c.connected_at >= b.range_start and c.connected_at < b.range_end
  and c.connection_status in ('connected', 'completed') and c.provider_group_type = 'group'
  and c.provider_space_id is not null and c.provider_line is not null
  and c.buyer_provider_identity is not null and c.seller_provider_identity is not null
  and c.provider_introduction_message_id is not null and c.connected_at is not null),
totals as (select count(*)::bigint deals, coalesce(sum(agreed_price_cents), 0)::bigint gmv,
  coalesce(round(avg(agreed_price_cents)), 0)::bigint average_price from selected_deals),
introductions as (select count(*)::bigint count from selected_introductions)
select jsonb_build_object('totalDeals', totals.deals, 'gmvCents', totals.gmv, 'averageDealPriceCents', totals.average_price,
  'dealConversionPercent', case when introductions.count = 0 then 0 else round(totals.deals::numeric / introductions.count * 100, 1) end,
  'averageDaysToDeal', (select round(avg(extract(epoch from (d.agreed_at - l.published_at)) / 86400)::numeric, 1)
    from selected_deals d join listings l on l.id = d.listing_id where l.published_at is not null and d.agreed_at >= l.published_at),
  'categories', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'deals', deals, 'gmvCents', gmv) order by deals desc, label), '[]'::jsonb)
    from (select coalesce(l.category, 'Uncategorized') label, count(*)::bigint deals, sum(d.agreed_price_cents)::bigint gmv
      from selected_deals d join listings l on l.id = d.listing_id group by 1) x))
from totals cross join introductions;
$$;

create or replace function admin_growth_timeline(requested_range text)
returns jsonb language sql stable security definer set search_path = public as $$
with bounds as (select * from admin_analytics_bounds(requested_range)),
first_fact as (select least((select min(u.created_at) from users u), (select min(l.created_at) from listings l),
  (select min(c.created_at) from conversations c), (select min(c.connected_at) from conversations c), (select min(d.agreed_at) from deals d)) occurred_at),
effective as (select case when requested_range = 'all' then coalesce(date_trunc('day', first_fact.occurred_at at time zone 'America/New_York') at time zone 'America/New_York', b.range_end - interval '1 day') else b.range_start end range_start, b.range_end from bounds b cross join first_fact),
days as (select generate_series(e.range_start, e.range_end - interval '1 day', interval '1 day') day_start from effective e),
facts as (
  select 'users' metric, u.created_at occurred_at from users u union all
  select 'listings', l.created_at from listings l union all select 'conversations', c.created_at from conversations c union all
  select 'introductions', c.connected_at from conversations c where c.connection_status in ('connected', 'completed') and c.provider_group_type = 'group'
    and c.provider_space_id is not null and c.provider_line is not null and c.buyer_provider_identity is not null and c.seller_provider_identity is not null
    and c.provider_introduction_message_id is not null and c.connected_at is not null union all
  select 'deals', d.agreed_at from deals d
), daily_counts as (
  select d.day_start,
    count(*) filter (where f.metric = 'users')::bigint users,
    count(*) filter (where f.metric = 'listings')::bigint listings,
    count(*) filter (where f.metric = 'conversations')::bigint conversations,
    count(*) filter (where f.metric = 'introductions')::bigint introductions,
    count(*) filter (where f.metric = 'deals')::bigint deals
  from days d left join facts f on f.occurred_at >= d.day_start and f.occurred_at < d.day_start + interval '1 day'
  group by d.day_start
)
select coalesce(jsonb_agg(jsonb_build_object('date', to_char(day_start at time zone 'America/New_York', 'YYYY-MM-DD'),
  'users', users, 'listings', listings, 'conversations', conversations, 'introductions', introductions,
  'deals', deals) order by day_start), '[]'::jsonb)
from daily_counts;
$$;

revoke all on function admin_analytics_bounds(text, timestamptz) from public, anon, authenticated;
revoke all on function admin_marketplace_overview(text) from public, anon, authenticated;
revoke all on function admin_marketplace_funnel(text) from public, anon, authenticated;
revoke all on function admin_supply_analytics() from public, anon, authenticated;
revoke all on function admin_deal_analytics(text) from public, anon, authenticated;
revoke all on function admin_growth_timeline(text) from public, anon, authenticated;
grant execute on function admin_analytics_bounds(text, timestamptz) to service_role;
grant execute on function admin_marketplace_overview(text) to service_role;
grant execute on function admin_marketplace_funnel(text) to service_role;
grant execute on function admin_supply_analytics() to service_role;
grant execute on function admin_deal_analytics(text) to service_role;
grant execute on function admin_growth_timeline(text) to service_role;
