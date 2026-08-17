begin;

create table public.provider_account_usage (
  device_id uuid not null references public.devices(id) on delete cascade,
  provider text not null check (provider in ('codex')),
  party_id uuid not null references public.parties(id) on delete cascade,
  plan_type text check (plan_type is null or char_length(plan_type) between 1 and 40),
  primary_used_percent numeric(5, 2) check (primary_used_percent between 0 and 100),
  primary_window_minutes integer check (primary_window_minutes > 0),
  primary_resets_at timestamptz,
  secondary_used_percent numeric(5, 2) check (secondary_used_percent between 0 and 100),
  secondary_window_minutes integer check (secondary_window_minutes > 0),
  secondary_resets_at timestamptz,
  lifetime_tokens bigint check (lifetime_tokens >= 0),
  daily_tokens bigint check (daily_tokens >= 0),
  checked_at timestamptz not null default now(),
  primary key (device_id, provider)
);

create index provider_account_usage_party_idx
  on public.provider_account_usage(party_id);

alter table public.provider_account_usage enable row level security;
alter table public.provider_account_usage replica identity full;

create policy provider_account_usage_select_members
on public.provider_account_usage
for select to authenticated
using (private.is_party_member(party_id));

create policy provider_account_usage_insert_connector
on public.provider_account_usage
for insert to authenticated
with check (private.is_active_connector(party_id, device_id));

create policy provider_account_usage_update_connector
on public.provider_account_usage
for update to authenticated
using (private.is_active_connector(party_id, device_id))
with check (private.is_active_connector(party_id, device_id));

grant select, insert, update on public.provider_account_usage to authenticated;

create function public.connector_record_provider_usage(
  p_party_id uuid,
  p_device_id uuid,
  p_provider text,
  p_plan_type text default null,
  p_primary_used_percent numeric default null,
  p_primary_window_minutes integer default null,
  p_primary_resets_at timestamptz default null,
  p_secondary_used_percent numeric default null,
  p_secondary_window_minutes integer default null,
  p_secondary_resets_at timestamptz default null,
  p_lifetime_tokens bigint default null,
  p_daily_tokens bigint default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_provider <> 'codex' then raise exception 'Unsupported provider usage source'; end if;
  if p_plan_type is not null and char_length(p_plan_type) not between 1 and 40 then raise exception 'Invalid plan type'; end if;
  if p_primary_used_percent is not null and p_primary_used_percent not between 0 and 100 then raise exception 'Invalid primary usage'; end if;
  if p_secondary_used_percent is not null and p_secondary_used_percent not between 0 and 100 then raise exception 'Invalid secondary usage'; end if;
  if p_primary_window_minutes is not null and p_primary_window_minutes <= 0 then raise exception 'Invalid primary window'; end if;
  if p_secondary_window_minutes is not null and p_secondary_window_minutes <= 0 then raise exception 'Invalid secondary window'; end if;
  if p_lifetime_tokens is not null and p_lifetime_tokens < 0 then raise exception 'Invalid lifetime usage'; end if;
  if p_daily_tokens is not null and p_daily_tokens < 0 then raise exception 'Invalid daily usage'; end if;

  insert into public.provider_account_usage as target (
    device_id, provider, party_id, plan_type,
    primary_used_percent, primary_window_minutes, primary_resets_at,
    secondary_used_percent, secondary_window_minutes, secondary_resets_at,
    lifetime_tokens, daily_tokens, checked_at
  ) values (
    p_device_id, p_provider, p_party_id, p_plan_type,
    p_primary_used_percent, p_primary_window_minutes, p_primary_resets_at,
    p_secondary_used_percent, p_secondary_window_minutes, p_secondary_resets_at,
    p_lifetime_tokens, p_daily_tokens, now()
  )
  on conflict (device_id, provider) do update
  set party_id = excluded.party_id,
      plan_type = excluded.plan_type,
      primary_used_percent = excluded.primary_used_percent,
      primary_window_minutes = excluded.primary_window_minutes,
      primary_resets_at = excluded.primary_resets_at,
      secondary_used_percent = excluded.secondary_used_percent,
      secondary_window_minutes = excluded.secondary_window_minutes,
      secondary_resets_at = excluded.secondary_resets_at,
      lifetime_tokens = excluded.lifetime_tokens,
      daily_tokens = excluded.daily_tokens,
      checked_at = now();
end;
$$;

revoke all on function public.connector_record_provider_usage(uuid, uuid, text, text, numeric, integer, timestamptz, numeric, integer, timestamptz, bigint, bigint) from public, anon;
grant execute on function public.connector_record_provider_usage(uuid, uuid, text, text, numeric, integer, timestamptz, numeric, integer, timestamptz, bigint, bigint) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'provider_account_usage'
  ) then
    alter publication supabase_realtime add table public.provider_account_usage;
  end if;
end $$;

commit;
