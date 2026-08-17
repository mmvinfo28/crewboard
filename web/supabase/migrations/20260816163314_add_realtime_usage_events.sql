drop policy "parties_select_members" on public.parties;

create policy "parties_select_members_or_creator" on public.parties
for select to authenticated
using (
  created_by = (select auth.uid())
  or private.is_party_member(id)
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  party_id uuid not null references public.parties(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  provider text not null check (provider in ('claude', 'codex', 'gemini', 'custom')),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index usage_events_party_created_idx on public.usage_events(party_id, created_at desc);
create index usage_events_actor_idx on public.usage_events(actor_id);
create index usage_events_agent_idx on public.usage_events(agent_id);
create index usage_events_task_idx on public.usage_events(task_id);
create index usage_events_device_idx on public.usage_events(device_id);

alter table public.usage_events enable row level security;
alter table public.usage_events replica identity full;

create policy "usage_select_members" on public.usage_events
for select to authenticated
using (private.is_party_member(party_id));

create policy "usage_insert_actor" on public.usage_events
for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and private.is_party_member(party_id)
);

grant select, insert on public.usage_events to authenticated;
grant usage, select on sequence public.usage_events_id_seq to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'usage_events'
  ) then
    alter publication supabase_realtime add table public.usage_events;
  end if;
end
$$;
