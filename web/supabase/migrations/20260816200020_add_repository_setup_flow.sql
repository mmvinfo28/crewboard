begin;

create table public.repository_setup_requests (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.parties(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'completed', 'failed', 'expired')),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index repository_setup_requests_device_status_idx
on public.repository_setup_requests(device_id, status, created_at);

create unique index repository_setup_requests_one_active_per_device_idx
on public.repository_setup_requests(device_id)
where status in ('pending', 'claimed');

alter table public.repository_setup_requests enable row level security;

create policy repository_setup_requests_select_members
on public.repository_setup_requests
for select to authenticated
using (private.is_party_member(party_id));

create policy repository_setup_requests_insert_device_owner
on public.repository_setup_requests
for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and private.is_party_contributor(party_id)
  and exists (
    select 1
    from public.devices d
    where d.id = device_id
      and d.party_id = party_id
      and d.owner_id = (select auth.uid())
  )
);

grant select, insert on public.repository_setup_requests to authenticated;
grant all on public.repository_setup_requests to service_role;

create or replace function public.connector_claim_repository_setup(p_device_id uuid)
returns table(
  request_id uuid,
  party_id uuid,
  name text,
  description text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_request public.repository_setup_requests%rowtype;
begin
  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  update public.repository_setup_requests rsr
  set status = 'expired', updated_at = now()
  where rsr.device_id = p_device_id
    and rsr.party_id = current_session.party_id
    and rsr.status = 'pending'
    and rsr.expires_at <= now();

  select rsr.* into target_request
  from public.repository_setup_requests rsr
  where rsr.device_id = p_device_id
    and rsr.party_id = current_session.party_id
    and rsr.status = 'pending'
    and rsr.expires_at > now()
  order by rsr.created_at
  limit 1
  for update skip locked;

  if not found then return; end if;

  update public.repository_setup_requests
  set status = 'claimed', claimed_at = now(), updated_at = now()
  where id = target_request.id;

  return query select
    target_request.id,
    target_request.party_id,
    target_request.name,
    target_request.description,
    target_request.expires_at;
end;
$$;

create or replace function public.connector_complete_repository_setup(
  p_device_id uuid,
  p_request_id uuid,
  p_folder_label text,
  p_path_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_request public.repository_setup_requests%rowtype;
  new_project_id uuid;
begin
  if char_length(trim(p_folder_label)) not between 1 and 120
    or p_path_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid repository folder';
  end if;

  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  select rsr.* into target_request
  from public.repository_setup_requests rsr
  where rsr.id = p_request_id
    and rsr.device_id = p_device_id
    and rsr.party_id = current_session.party_id
    and rsr.status = 'claimed'
    and rsr.expires_at > now()
  for update;
  if not found then raise exception 'Repository request is inactive'; end if;

  insert into public.projects (party_id, created_by, name, description)
  values (
    current_session.party_id,
    target_request.requested_by,
    target_request.name,
    target_request.description
  )
  returning id into new_project_id;

  insert into public.device_folders (
    party_id, project_id, device_id, label, path_fingerprint
  ) values (
    current_session.party_id,
    new_project_id,
    p_device_id,
    trim(p_folder_label),
    p_path_fingerprint
  );

  update public.repository_setup_requests
  set status = 'completed', project_id = new_project_id,
      completed_at = now(), updated_at = now()
  where id = p_request_id;

  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (
    current_session.party_id,
    target_request.requested_by,
    'repository_added',
    jsonb_build_object('name', target_request.name, 'project_id', new_project_id)
  );

  return new_project_id;
end;
$$;

create or replace function public.connector_fail_repository_setup(
  p_device_id uuid,
  p_request_id uuid,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
begin
  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id);
  if not found then raise exception 'Device session is inactive'; end if;

  update public.repository_setup_requests rsr
  set status = 'failed',
      error_message = left(coalesce(nullif(trim(p_error_message), ''), 'Folder selection was cancelled'), 500),
      completed_at = now(), updated_at = now()
  where rsr.id = p_request_id
    and rsr.device_id = p_device_id
    and rsr.party_id = current_session.party_id
    and rsr.status = 'claimed';

  return found;
end;
$$;

revoke all on function public.connector_claim_repository_setup(uuid) from public, anon;
revoke all on function public.connector_complete_repository_setup(uuid, uuid, text, text) from public, anon;
revoke all on function public.connector_fail_repository_setup(uuid, uuid, text) from public, anon;
grant execute on function public.connector_claim_repository_setup(uuid) to authenticated;
grant execute on function public.connector_complete_repository_setup(uuid, uuid, text, text) to authenticated;
grant execute on function public.connector_fail_repository_setup(uuid, uuid, text) to authenticated;

create or replace function private.broadcast_repository_setup_wakeup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object('type', 'repository_setup'),
    'sync',
    'party:' || new.party_id::text,
    true
  );
  return new;
end;
$$;

create trigger repository_setup_requests_broadcast_wakeup
after insert on public.repository_setup_requests
for each row execute function private.broadcast_repository_setup_wakeup();

commit;
