create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (party_id, user_id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  platform text not null default 'unknown' check (platform in ('macos', 'windows', 'linux', 'unknown')),
  status text not null default 'offline' check (status in ('online', 'offline', 'connecting')),
  connector_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  provider text not null check (provider in ('claude', 'codex', 'gemini', 'custom')),
  model text not null check (char_length(model) between 1 and 100),
  status text not null default 'offline' check (status in ('ready', 'working', 'paused', 'offline')),
  current_task_summary text,
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  assigned_agent_id uuid references public.agents(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  status text not null default 'queued' check (status in ('queued', 'running', 'blocked', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.activity_events (
  id bigint generated always as identity primary key,
  party_id uuid not null references public.parties(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index party_members_user_idx on public.party_members(user_id);
create index devices_party_idx on public.devices(party_id);
create index devices_owner_idx on public.devices(owner_id);
create index agents_party_idx on public.agents(party_id);
create index agents_owner_idx on public.agents(owner_id);
create index tasks_party_status_idx on public.tasks(party_id, status);
create index tasks_assigned_agent_idx on public.tasks(assigned_agent_id);
create index activity_events_party_created_idx on public.activity_events(party_id, created_at desc);

create or replace function private.is_party_member(target_party uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.party_members pm
    where pm.party_id = target_party and pm.user_id = (select auth.uid())
  );
$$;
create or replace function private.is_party_admin(target_party uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.party_members pm
    where pm.party_id = target_party
      and pm.user_id = (select auth.uid())
      and pm.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_party_member(uuid) from public;
revoke all on function private.is_party_admin(uuid) from public;
grant execute on function private.is_party_member(uuid) to authenticated;
grant execute on function private.is_party_admin(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.parties enable row level security;
alter table public.party_members enable row level security;
alter table public.devices enable row level security;
alter table public.agents enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_events enable row level security;

create policy "profiles_select_party_peers" on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.party_members mine
    join public.party_members theirs on theirs.party_id = mine.party_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
  )
);
create policy "profiles_insert_self" on public.profiles for insert to authenticated
with check (id = (select auth.uid()));
create policy "profiles_update_self" on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "parties_select_members" on public.parties for select to authenticated
using (private.is_party_member(id));
create policy "parties_insert_creator" on public.parties for insert to authenticated
with check (created_by = (select auth.uid()));
create policy "parties_update_admins" on public.parties for update to authenticated
using (private.is_party_admin(id)) with check (private.is_party_admin(id));
create policy "parties_delete_owners" on public.parties for delete to authenticated
using (exists (
  select 1 from public.party_members pm
  where pm.party_id = parties.id and pm.user_id = (select auth.uid()) and pm.role = 'owner'
));

create policy "members_select_party" on public.party_members for select to authenticated
using (private.is_party_member(party_id));
create policy "members_insert_creator_or_admin" on public.party_members for insert to authenticated
with check (
  private.is_party_admin(party_id)
  or (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.parties p
      where p.id = party_id and p.created_by = (select auth.uid())
    )
  )
);
create policy "members_update_admins" on public.party_members for update to authenticated
using (private.is_party_admin(party_id)) with check (private.is_party_admin(party_id));
create policy "members_delete_self_or_admin" on public.party_members for delete to authenticated
using (user_id = (select auth.uid()) or private.is_party_admin(party_id));

create policy "devices_select_members" on public.devices for select to authenticated
using (private.is_party_member(party_id));
create policy "devices_insert_owner" on public.devices for insert to authenticated
with check (owner_id = (select auth.uid()) and private.is_party_member(party_id));
create policy "devices_update_owner" on public.devices for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()) and private.is_party_member(party_id));
create policy "devices_delete_owner" on public.devices for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "agents_select_members" on public.agents for select to authenticated
using (private.is_party_member(party_id));
create policy "agents_insert_owner" on public.agents for insert to authenticated
with check (owner_id = (select auth.uid()) and private.is_party_member(party_id));
create policy "agents_update_owner_or_admin" on public.agents for update to authenticated
using (owner_id = (select auth.uid()) or private.is_party_admin(party_id))
with check (owner_id = (select auth.uid()) or private.is_party_admin(party_id));
create policy "agents_delete_owner_or_admin" on public.agents for delete to authenticated
using (owner_id = (select auth.uid()) or private.is_party_admin(party_id));

create policy "tasks_select_members" on public.tasks for select to authenticated
using (private.is_party_member(party_id));
create policy "tasks_insert_members" on public.tasks for insert to authenticated
with check (created_by = (select auth.uid()) and private.is_party_member(party_id));
create policy "tasks_update_members" on public.tasks for update to authenticated
using (private.is_party_member(party_id)) with check (private.is_party_member(party_id));
create policy "tasks_delete_creator_or_admin" on public.tasks for delete to authenticated
using (created_by = (select auth.uid()) or private.is_party_admin(party_id));

create policy "activity_select_members" on public.activity_events for select to authenticated
using (private.is_party_member(party_id));
create policy "activity_insert_members" on public.activity_events for insert to authenticated
with check (actor_id = (select auth.uid()) and private.is_party_member(party_id));

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.agents replica identity full;
alter table public.tasks replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agents'
  ) then alter publication supabase_realtime add table public.agents; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then alter publication supabase_realtime add table public.tasks; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activity_events'
  ) then alter publication supabase_realtime add table public.activity_events; end if;
end
$$;
