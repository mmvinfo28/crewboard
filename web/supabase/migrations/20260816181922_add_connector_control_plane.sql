begin;

-- Party viewers can observe, but cannot create or mutate work.
alter table public.party_members drop constraint if exists party_members_role_check;
alter table public.party_members
  add constraint party_members_role_check
  check (role in ('owner', 'admin', 'member', 'viewer'));

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status in ('queued', 'running', 'approval_needed', 'blocked', 'completed', 'failed', 'cancelled'));

alter table public.tasks
  add column priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  add column required_capabilities jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_capabilities) = 'array'),
  add column assigned_device_id uuid references public.devices(id) on delete set null;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks
  add column project_id uuid references public.projects(id) on delete set null;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  code_hash bytea not null unique,
  role text not null default 'member' check (role in ('member', 'viewer')),
  max_uses integer not null default 1 check (max_uses between 1 and 1000),
  use_count integer not null default 0 check (use_count >= 0 and use_count <= max_uses),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  device_name text not null check (char_length(device_name) between 1 and 120),
  platform text not null check (platform in ('macos', 'windows', 'linux', 'unknown')),
  connector_version text not null check (char_length(connector_version) between 1 and 40),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'redeemed', 'expired', 'cancelled')),
  approved_party_id uuid references public.parties(id) on delete cascade,
  approved_by uuid references public.profiles(id) on delete cascade,
  approved_at timestamptz,
  redeemed_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  token_generation integer not null default 1 check (token_generation > 0),
  last_used_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.device_pairing_secrets (
  pairing_id uuid primary key references public.device_pairings(id) on delete cascade,
  code_hash bytea not null unique,
  pairing_secret_hash bytea not null unique,
  request_ip_hash bytea not null
);

create table private.device_session_tokens (
  session_id uuid primary key references public.device_sessions(id) on delete cascade,
  token_hash bytea not null unique,
  previous_token_hash bytea unique,
  previous_valid_until timestamptz
);

create table public.device_folders (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 120),
  path_fingerprint text not null check (char_length(path_fingerprint) between 16 and 128),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, device_id)
);

create table public.task_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  party_id uuid not null references public.parties(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  agent_id uuid references public.agents(id) on delete set null,
  session_id uuid not null references public.device_sessions(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  attempt integer not null check (attempt > 0),
  status text not null default 'running'
    check (status in ('running', 'approval_needed', 'completed', 'failed', 'cancelled', 'expired')),
  lease_expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null default now(),
  result_summary text,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, idempotency_key)
);

create unique index task_runs_one_active_per_task_idx
  on public.task_runs(task_id)
  where status in ('running', 'approval_needed');

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  run_id uuid not null references public.task_runs(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  requested_by_session_id uuid not null references public.device_sessions(id) on delete restrict,
  kind text not null check (kind in ('launch', 'shell', 'write', 'network')),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index projects_party_idx on public.projects(party_id);
create index projects_created_by_idx on public.projects(created_by);
create index invitations_party_created_idx on public.invitations(party_id, created_at desc);
create index invitations_created_by_idx on public.invitations(created_by);
create index device_pairings_approved_party_idx on public.device_pairings(approved_party_id);
create index device_pairings_approved_by_idx on public.device_pairings(approved_by);
create index device_pairings_expiry_idx on public.device_pairings(expires_at) where status in ('pending', 'approved');
create index device_pairing_secrets_ip_idx on private.device_pairing_secrets(request_ip_hash);
create index device_sessions_device_idx on public.device_sessions(device_id);
create index device_sessions_party_idx on public.device_sessions(party_id);
create index device_sessions_owner_idx on public.device_sessions(owner_id);
create index device_sessions_active_idx on public.device_sessions(device_id, expires_at)
  where revoked_at is null;
create index device_folders_party_idx on public.device_folders(party_id);
create index device_folders_device_idx on public.device_folders(device_id);
create index task_runs_party_created_idx on public.task_runs(party_id, created_at desc);
create index task_runs_device_status_idx on public.task_runs(device_id, status);
create index task_runs_session_idx on public.task_runs(session_id);
create index task_runs_agent_idx on public.task_runs(agent_id);
create index task_runs_lease_idx on public.task_runs(lease_expires_at)
  where status in ('running', 'approval_needed');
create index approval_requests_party_created_idx on public.approval_requests(party_id, created_at desc);
create index approval_requests_task_idx on public.approval_requests(task_id);
create index approval_requests_run_idx on public.approval_requests(run_id);
create index approval_requests_device_idx on public.approval_requests(device_id);
create index approval_requests_session_idx on public.approval_requests(requested_by_session_id);
create index approval_requests_decided_by_idx on public.approval_requests(decided_by);
create index approval_requests_pending_idx on public.approval_requests(expires_at)
  where status = 'pending';
create index tasks_assigned_device_idx on public.tasks(assigned_device_id);
create index tasks_project_idx on public.tasks(project_id);
create index tasks_claim_queue_idx on public.tasks(party_id, priority, created_at)
  where status = 'queued';

create or replace function private.is_party_contributor(target_party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.party_members pm
    where pm.party_id = target_party
      and pm.user_id = (select auth.uid())
      and pm.role in ('owner', 'admin', 'member')
  );
$$;

create or replace function private.is_active_connector(target_party uuid, target_device uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select auth.jwt() ->> 'connector') = 'true', false)
    and exists (
      select 1
      from public.device_sessions ds
      where ds.id = (select auth.uid())
        and ds.party_id = target_party
        and (target_device is null or ds.device_id = target_device)
        and ds.revoked_at is null
        and ds.expires_at > now()
    );
$$;

revoke all on function private.is_party_contributor(uuid) from public, anon;
revoke all on function private.is_active_connector(uuid, uuid) from public, anon;
grant execute on function private.is_party_contributor(uuid) to authenticated;
grant execute on function private.is_active_connector(uuid, uuid) to authenticated;

alter table public.projects enable row level security;
alter table public.invitations enable row level security;
alter table public.device_pairings enable row level security;
alter table public.device_sessions enable row level security;
alter table public.device_folders enable row level security;
alter table public.task_runs enable row level security;
alter table public.approval_requests enable row level security;
alter table private.device_pairing_secrets enable row level security;
alter table private.device_session_tokens enable row level security;

create policy projects_select_members on public.projects
for select to authenticated using (private.is_party_member(party_id));
create policy projects_insert_contributors on public.projects
for insert to authenticated with check (
  created_by = (select auth.uid()) and private.is_party_contributor(party_id)
);
create policy projects_update_creator_or_admin on public.projects
for update to authenticated
using (created_by = (select auth.uid()) or private.is_party_admin(party_id))
with check (created_by = (select auth.uid()) or private.is_party_admin(party_id));
create policy projects_delete_creator_or_admin on public.projects
for delete to authenticated
using (created_by = (select auth.uid()) or private.is_party_admin(party_id));

create policy invitations_select_admins on public.invitations
for select to authenticated using (private.is_party_admin(party_id));
create policy invitations_insert_admins on public.invitations
for insert to authenticated with check (
  created_by = (select auth.uid()) and private.is_party_admin(party_id)
);
create policy invitations_update_admins on public.invitations
for update to authenticated
using (private.is_party_admin(party_id))
with check (private.is_party_admin(party_id));
create policy invitations_delete_admins on public.invitations
for delete to authenticated using (private.is_party_admin(party_id));

create policy device_sessions_select_owner_or_admin on public.device_sessions
for select to authenticated
using (owner_id = (select auth.uid()) or private.is_party_admin(party_id));

create policy device_folders_select_party_or_connector on public.device_folders
for select to authenticated
using (private.is_party_member(party_id) or private.is_active_connector(party_id, device_id));
create policy device_folders_insert_owner_or_admin on public.device_folders
for insert to authenticated with check (
  private.is_party_contributor(party_id)
  and exists (
    select 1 from public.devices d
    where d.id = device_id
      and d.party_id = party_id
      and (d.owner_id = (select auth.uid()) or private.is_party_admin(party_id))
  )
);
create policy device_folders_update_owner_or_admin on public.device_folders
for update to authenticated
using (exists (
  select 1 from public.devices d
  where d.id = device_id
    and (d.owner_id = (select auth.uid()) or private.is_party_admin(party_id))
))
with check (private.is_party_contributor(party_id));
create policy device_folders_delete_owner_or_admin on public.device_folders
for delete to authenticated
using (exists (
  select 1 from public.devices d
  where d.id = device_id
    and (d.owner_id = (select auth.uid()) or private.is_party_admin(party_id))
));

create policy task_runs_select_party_or_connector on public.task_runs
for select to authenticated
using (private.is_party_member(party_id) or private.is_active_connector(party_id, device_id));

create policy approvals_select_party_or_connector on public.approval_requests
for select to authenticated
using (private.is_party_member(party_id) or private.is_active_connector(party_id, device_id));

drop policy if exists tasks_insert_members on public.tasks;
drop policy if exists tasks_update_members on public.tasks;
create policy tasks_insert_contributors on public.tasks
for insert to authenticated with check (
  created_by = (select auth.uid()) and private.is_party_contributor(party_id)
);
create policy tasks_update_creator_or_admin on public.tasks
for update to authenticated
using (
  private.is_party_contributor(party_id)
  and (created_by = (select auth.uid()) or private.is_party_admin(party_id))
)
with check (
  private.is_party_contributor(party_id)
  and (created_by = (select auth.uid()) or private.is_party_admin(party_id))
);

drop policy if exists devices_insert_owner on public.devices;
drop policy if exists devices_update_owner on public.devices;
create policy devices_insert_owner on public.devices
for insert to authenticated with check (
  owner_id = (select auth.uid()) and private.is_party_contributor(party_id)
);
create policy devices_update_owner_or_admin on public.devices
for update to authenticated
using (owner_id = (select auth.uid()) or private.is_party_admin(party_id))
with check (
  private.is_party_contributor(party_id)
  and (owner_id = (select auth.uid()) or private.is_party_admin(party_id))
);

drop policy if exists agents_insert_owner on public.agents;
drop policy if exists agents_update_owner_or_admin on public.agents;
create policy agents_insert_owner on public.agents
for insert to authenticated with check (
  owner_id = (select auth.uid()) and private.is_party_contributor(party_id)
);
create policy agents_update_owner_or_admin on public.agents
for update to authenticated
using (owner_id = (select auth.uid()) or private.is_party_admin(party_id))
with check (
  private.is_party_contributor(party_id)
  and (owner_id = (select auth.uid()) or private.is_party_admin(party_id))
);

drop policy if exists activity_insert_members on public.activity_events;
create policy activity_insert_contributors on public.activity_events
for insert to authenticated with check (
  actor_id = (select auth.uid()) and private.is_party_contributor(party_id)
);

drop policy if exists usage_insert_actor on public.usage_events;
create policy usage_insert_actor on public.usage_events
for insert to authenticated with check (
  actor_id = (select auth.uid()) and private.is_party_contributor(party_id)
);

-- Server-only: create a short-lived pairing while applying database rate limits.
create or replace function public.connector_pair_start(
  p_code_hash bytea,
  p_pairing_secret_hash bytea,
  p_request_ip_hash bytea,
  p_device_name text,
  p_platform text,
  p_connector_version text
)
returns table(pairing_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_pairing_id uuid;
  new_expires_at timestamptz := now() + interval '10 minutes';
begin
  if octet_length(p_code_hash) <> 32
    or octet_length(p_pairing_secret_hash) <> 32
    or octet_length(p_request_ip_hash) <> 32 then
    raise exception 'Invalid pairing material';
  end if;
  if char_length(trim(p_device_name)) not between 1 and 120 then
    raise exception 'Invalid device name';
  end if;
  if p_platform not in ('macos', 'windows', 'linux', 'unknown') then
    raise exception 'Invalid platform';
  end if;
  if char_length(p_connector_version) not between 1 and 40 then
    raise exception 'Invalid connector version';
  end if;
  if (
    select count(*)
    from public.device_pairings dp
    join private.device_pairing_secrets dps on dps.pairing_id = dp.id
    where dps.request_ip_hash = p_request_ip_hash
      and dp.created_at > now() - interval '10 minutes'
  ) >= 5 then
    raise exception 'Pairing rate limit exceeded';
  end if;

  insert into public.device_pairings (
    device_name, platform, connector_version, expires_at
  ) values (
    trim(p_device_name), p_platform, p_connector_version, new_expires_at
  ) returning id into new_pairing_id;

  insert into private.device_pairing_secrets (
    pairing_id, code_hash, pairing_secret_hash, request_ip_hash
  ) values (
    new_pairing_id, p_code_hash, p_pairing_secret_hash, p_request_ip_hash
  );

  return query select new_pairing_id, new_expires_at;
end;
$$;

-- Browser user: approve a code for a party they can contribute to.
create or replace function public.approve_device_pairing(
  p_code_hash bytea,
  p_party_id uuid,
  p_user_id uuid
)
returns table(pairing_id uuid, device_name text, platform text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pairing public.device_pairings%rowtype;
begin
  if p_user_id is null or not exists (
    select 1 from public.party_members pm
    where pm.party_id = p_party_id
      and pm.user_id = p_user_id
      and pm.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Not allowed';
  end if;

  select dp.* into target_pairing
  from public.device_pairings dp
  join private.device_pairing_secrets dps on dps.pairing_id = dp.id
  where dps.code_hash = p_code_hash
    and dp.status = 'pending'
    and dp.attempts < 5
    and dp.expires_at > now()
  for update of dp;

  if not found then
    raise exception 'Pairing code is invalid or expired';
  end if;

  update public.device_pairings
  set status = 'approved',
      approved_party_id = p_party_id,
      approved_by = p_user_id,
      approved_at = now()
  where id = target_pairing.id;

  return query
    select target_pairing.id, target_pairing.device_name,
           target_pairing.platform, target_pairing.expires_at;
end;
$$;

-- Server-only: atomically consume an approved pairing and create the device session.
create or replace function public.connector_pair_redeem(
  p_code_hash bytea,
  p_pairing_secret_hash bytea,
  p_refresh_token_hash bytea
)
returns table(
  session_id uuid,
  device_id uuid,
  party_id uuid,
  owner_id uuid,
  session_expires_at timestamptz,
  connector_version text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pairing public.device_pairings%rowtype;
  expected_secret_hash bytea;
  new_device_id uuid;
  new_session_id uuid;
  new_session_expires_at timestamptz := now() + interval '30 days';
begin
  select dp.*
  into target_pairing
  from public.device_pairings dp
  join private.device_pairing_secrets dps on dps.pairing_id = dp.id
  where dps.code_hash = p_code_hash
  for update of dp;

  if not found then return; end if;
  select dps.pairing_secret_hash into expected_secret_hash
  from private.device_pairing_secrets dps
  where dps.pairing_id = target_pairing.id;
  if target_pairing.expires_at <= now() or target_pairing.attempts >= 5 then
    update public.device_pairings set status = 'expired' where id = target_pairing.id;
    return;
  end if;
  if expected_secret_hash <> p_pairing_secret_hash then
    update public.device_pairings
    set attempts = least(attempts + 1, 5),
        status = case when attempts + 1 >= 5 then 'expired' else status end
    where id = target_pairing.id;
    return;
  end if;
  if target_pairing.status <> 'approved'
    or target_pairing.approved_party_id is null
    or target_pairing.approved_by is null then
    return;
  end if;

  insert into public.devices (
    party_id, owner_id, name, platform, status, connector_version, last_seen_at
  ) values (
    target_pairing.approved_party_id, target_pairing.approved_by,
    target_pairing.device_name, target_pairing.platform, 'connecting',
    target_pairing.connector_version, now()
  ) returning id into new_device_id;

  insert into public.device_sessions (
    device_id, party_id, owner_id, expires_at, last_used_at
  ) values (
    new_device_id, target_pairing.approved_party_id,
    target_pairing.approved_by, new_session_expires_at, now()
  ) returning id into new_session_id;

  insert into private.device_session_tokens (session_id, token_hash)
  values (new_session_id, p_refresh_token_hash);

  update public.device_pairings
  set status = 'redeemed', redeemed_at = now()
  where id = target_pairing.id;

  return query select
    new_session_id, new_device_id, target_pairing.approved_party_id,
    target_pairing.approved_by, new_session_expires_at,
    target_pairing.connector_version;
end;
$$;

-- Server-only: rotate a device refresh token with a short overlap for lost responses.
create or replace function public.connector_rotate_session(
  p_refresh_token_hash bytea,
  p_next_refresh_token_hash bytea,
  p_connector_version text
)
returns table(
  session_id uuid,
  device_id uuid,
  party_id uuid,
  owner_id uuid,
  session_expires_at timestamptz,
  token_generation integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.device_sessions%rowtype;
  target_tokens private.device_session_tokens%rowtype;
begin
  select dst.*
  into target_tokens
  from private.device_session_tokens dst
  where dst.token_hash = p_refresh_token_hash
     or (
       dst.previous_token_hash = p_refresh_token_hash
       and dst.previous_valid_until > now()
     )
  for update;

  if not found then return; end if;

  select ds.* into target_session
  from public.device_sessions ds
  where ds.id = target_tokens.session_id
  for update;

  if not found
    or target_session.revoked_at is not null
    or target_session.expires_at <= now() then
    return;
  end if;

  update private.device_session_tokens as dst
  set previous_token_hash = token_hash,
      previous_valid_until = now() + interval '30 seconds',
      token_hash = p_next_refresh_token_hash
  where dst.session_id = target_session.id;

  update public.device_sessions as ds
  set token_generation = ds.token_generation + 1,
      last_used_at = now(),
      expires_at = now() + interval '30 days'
  where ds.id = target_session.id
  returning * into target_session;

  update public.devices
  set status = 'online',
      connector_version = p_connector_version,
      last_seen_at = now()
  where id = target_session.device_id;

  return query select
    target_session.id, target_session.device_id, target_session.party_id,
    target_session.owner_id, target_session.expires_at,
    target_session.token_generation;
end;
$$;

create or replace function public.revoke_device_session(p_session_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.device_sessions%rowtype;
begin
  select * into target_session
  from public.device_sessions
  where id = p_session_id
  for update;

  if not found then return false; end if;
  if target_session.owner_id <> p_user_id
    and not exists (
      select 1 from public.party_members pm
      where pm.party_id = target_session.party_id
        and pm.user_id = p_user_id
        and pm.role in ('owner', 'admin')
    ) then
    raise exception 'Not allowed';
  end if;

  update public.device_sessions
  set revoked_at = coalesce(revoked_at, now())
  where id = p_session_id;

  update public.devices
  set status = 'offline'
  where id = target_session.device_id
    and not exists (
      select 1 from public.device_sessions active
      where active.device_id = target_session.device_id
        and active.id <> p_session_id
        and active.revoked_at is null
        and active.expires_at > now()
    );

  return true;
end;
$$;

-- Connector JWT: atomically choose and lease one compatible task.
create or replace function public.claim_next_task(
  p_device_id uuid,
  p_agent_id uuid,
  p_capabilities jsonb,
  p_idempotency_key text,
  p_lease_seconds integer default 90
)
returns table(
  run_id uuid,
  task_id uuid,
  party_id uuid,
  project_id uuid,
  folder_id uuid,
  title text,
  description text,
  priority text,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_task public.tasks%rowtype;
  target_folder_id uuid;
  new_run_id uuid;
  new_lease_expires_at timestamptz;
  next_attempt integer;
begin
  if coalesce((select auth.jwt() ->> 'connector') = 'true', false) is not true then
    raise exception 'Connector authentication required';
  end if;
  if jsonb_typeof(p_capabilities) <> 'array' then
    raise exception 'Capabilities must be an array';
  end if;
  if char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid idempotency key';
  end if;
  p_lease_seconds := greatest(30, least(p_lease_seconds, 300));

  select * into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and ds.revoked_at is null
    and ds.expires_at > now()
  for update;

  if not found then raise exception 'Device session is inactive'; end if;
  if p_agent_id is not null and not exists (
    select 1 from public.agents a
    where a.id = p_agent_id
      and a.device_id = p_device_id
      and a.party_id = current_session.party_id
  ) then
    raise exception 'Agent does not belong to this device';
  end if;

  select t.*
  into target_task
  from public.tasks t
  left join public.device_folders df
    on df.project_id = t.project_id
   and df.device_id = p_device_id
   and df.enabled = true
  where t.party_id = current_session.party_id
    and t.status = 'queued'
    and (t.assigned_device_id is null or t.assigned_device_id = p_device_id)
    and (t.assigned_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (t.project_id is null or df.id is not null)
    and p_capabilities @> t.required_capabilities
  order by
    case t.priority
      when 'critical' then 4
      when 'high' then 3
      when 'medium' then 2
      else 1
    end desc,
    t.created_at
  limit 1
  for update of t skip locked;

  if not found then return; end if;

  if target_task.project_id is not null then
    select df.id into target_folder_id
    from public.device_folders df
    where df.project_id = target_task.project_id
      and df.device_id = p_device_id
      and df.enabled = true;
  end if;

  select coalesce(max(tr.attempt), 0) + 1 into next_attempt
  from public.task_runs tr
  where tr.task_id = target_task.id;

  new_lease_expires_at := now() + make_interval(secs => p_lease_seconds);
  insert into public.task_runs (
    task_id, party_id, device_id, agent_id, session_id,
    idempotency_key, attempt, lease_expires_at
  ) values (
    target_task.id, target_task.party_id, p_device_id, p_agent_id,
    current_session.id, p_idempotency_key, next_attempt, new_lease_expires_at
  ) returning id into new_run_id;

  update public.tasks
  set status = 'running',
      assigned_device_id = p_device_id,
      assigned_agent_id = coalesce(p_agent_id, assigned_agent_id),
      updated_at = now()
  where id = target_task.id;

  update public.device_sessions
  set last_used_at = now()
  where id = current_session.id;

  return query select
    new_run_id, target_task.id, target_task.party_id, target_task.project_id,
    target_folder_id, target_task.title, target_task.description,
    target_task.priority, new_lease_expires_at;
end;
$$;

create or replace function public.connector_heartbeat(
  p_device_id uuid,
  p_run_id uuid default null,
  p_connector_version text default null,
  p_lease_seconds integer default 90
)
returns table(device_status text, renewed_lease_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  renewed_until timestamptz;
begin
  if coalesce((select auth.jwt() ->> 'connector') = 'true', false) is not true then
    raise exception 'Connector authentication required';
  end if;
  p_lease_seconds := greatest(30, least(p_lease_seconds, 300));

  select * into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and ds.revoked_at is null
    and ds.expires_at > now()
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  update public.device_sessions set last_used_at = now()
  where id = current_session.id;
  update public.devices
  set status = 'online',
      connector_version = coalesce(p_connector_version, connector_version),
      last_seen_at = now()
  where id = p_device_id;

  if p_run_id is not null then
    renewed_until := now() + make_interval(secs => p_lease_seconds);
    update public.task_runs
    set lease_expires_at = renewed_until,
        last_heartbeat_at = now()
    where id = p_run_id
      and session_id = current_session.id
      and device_id = p_device_id
      and status in ('running', 'approval_needed');
    if not found then renewed_until := null; end if;
  end if;

  return query select 'online'::text, renewed_until;
end;
$$;

revoke all on function public.connector_pair_start(bytea, bytea, bytea, text, text, text) from public, anon, authenticated;
revoke all on function public.approve_device_pairing(bytea, uuid, uuid) from public, anon, authenticated;
revoke all on function public.connector_pair_redeem(bytea, bytea, bytea) from public, anon, authenticated;
revoke all on function public.connector_rotate_session(bytea, bytea, text) from public, anon, authenticated;
revoke all on function public.revoke_device_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_next_task(uuid, uuid, jsonb, text, integer) from public, anon;
revoke all on function public.connector_heartbeat(uuid, uuid, text, integer) from public, anon;

grant execute on function public.connector_pair_start(bytea, bytea, bytea, text, text, text) to service_role;
grant execute on function public.approve_device_pairing(bytea, uuid, uuid) to service_role;
grant execute on function public.connector_pair_redeem(bytea, bytea, bytea) to service_role;
grant execute on function public.connector_rotate_session(bytea, bytea, text) to service_role;
grant execute on function public.revoke_device_session(uuid, uuid) to service_role;
grant execute on function public.claim_next_task(uuid, uuid, jsonb, text, integer) to authenticated;
grant execute on function public.connector_heartbeat(uuid, uuid, text, integer) to authenticated;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;
grant select on public.device_sessions to authenticated;
grant select, insert, update, delete on public.device_folders to authenticated;
grant select on public.task_runs, public.approval_requests to authenticated;

-- New Supabase projects no longer auto-expose new public tables to the Data API.
grant all on public.device_pairings, public.device_sessions, public.task_runs to service_role;
grant all on private.device_pairing_secrets, private.device_session_tokens to service_role;

-- Realtime only carries a content-free nudge. Connectors fetch actual work through
-- an authenticated RPC, so a cached websocket policy never grants task access.
drop policy if exists connector_receive_party_wakeups on realtime.messages;
create policy connector_receive_party_wakeups
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and coalesce(((select auth.jwt()) ->> 'connector') = 'true', false)
  and realtime.topic() = 'party:' || ((select auth.jwt()) ->> 'party_id')
  and private.is_active_connector(
    (((select auth.jwt()) ->> 'party_id'))::uuid,
    (((select auth.jwt()) ->> 'device_id'))::uuid
  )
);

create or replace function private.broadcast_task_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'queued' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform realtime.send(
      jsonb_build_object('type', 'sync'),
      'sync',
      'party:' || new.party_id::text,
      true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_broadcast_wakeup on public.tasks;
create trigger tasks_broadcast_wakeup
after insert or update of status on public.tasks
for each row execute function private.broadcast_task_wakeup();

commit;
