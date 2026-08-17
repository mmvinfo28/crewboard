begin;

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check
  check (status in ('queued', 'running', 'approval_needed', 'blocked', 'interrupted', 'completed', 'failed', 'cancelled'));

alter table public.tasks
  add column task_kind text not null default 'work'
    check (task_kind in ('work', 'planner')),
  add column parent_task_id uuid references public.tasks(id) on delete cascade,
  add column split_agent_ids uuid[] not null default '{}'::uuid[],
  add column progress_summary text
    check (progress_summary is null or char_length(progress_summary) <= 500);

alter table public.tasks
  add constraint tasks_split_agents_limit_check
  check (cardinality(split_agent_ids) <= 8);

create index tasks_parent_idx on public.tasks(parent_task_id)
where parent_task_id is not null;

alter table public.projects
  add column source_type text not null default 'local'
    check (source_type in ('local', 'github')),
  add column repository_url text
    check (repository_url is null or char_length(repository_url) <= 500);

alter table public.repository_setup_requests
  add column source_type text not null default 'local'
    check (source_type in ('local', 'github')),
  add column repository_url text
    check (repository_url is null or char_length(repository_url) <= 500);

alter table public.repository_setup_requests
  add constraint repository_setup_source_check
  check (
    (source_type = 'local' and repository_url is null)
    or
    (source_type = 'github' and repository_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$')
  );

create table public.task_progress_events (
  id bigint generated always as identity primary key,
  party_id uuid not null references public.parties(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  run_id uuid not null references public.task_runs(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete restrict,
  kind text not null check (kind in ('status', 'update', 'tool', 'error')),
  message text not null check (char_length(message) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index task_progress_events_party_created_idx
on public.task_progress_events(party_id, created_at desc);
create index task_progress_events_task_created_idx
on public.task_progress_events(task_id, created_at desc);
create index task_progress_events_run_created_idx
on public.task_progress_events(run_id, created_at desc);

alter table public.task_progress_events enable row level security;
create policy task_progress_events_select_members
on public.task_progress_events for select to authenticated
using (private.is_party_member(party_id));

grant select on public.task_progress_events to authenticated;
grant all on public.task_progress_events to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'task_progress_events'
  ) then
    alter publication supabase_realtime add table public.task_progress_events;
  end if;
end
$$;

create or replace function public.create_crew_task(
  p_party_id uuid,
  p_title text,
  p_description text default '',
  p_priority text default 'medium',
  p_project_id uuid default null,
  p_assigned_agent_id uuid default null,
  p_auto_split boolean default false,
  p_split_agent_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  chosen_agent_ids uuid[] := coalesce(p_split_agent_ids, '{}'::uuid[]);
  coordinator_agent_id uuid;
  new_task_id uuid;
begin
  if current_user_id is null or not private.is_party_contributor(p_party_id) then
    raise exception 'You cannot create tasks in this party';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 160 then
    raise exception 'Task title must be between 1 and 160 characters';
  end if;
  if char_length(coalesce(p_description, '')) > 20000 then
    raise exception 'Task description is too long';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Invalid priority';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.party_id = p_party_id
  ) then
    raise exception 'Repository does not belong to this party';
  end if;

  if p_auto_split then
    if cardinality(chosen_agent_ids) not between 2 and 8 then
      raise exception 'Choose between 2 and 8 agents for an automatic split';
    end if;
    if cardinality(chosen_agent_ids) <> (
      select count(distinct a.id)::integer
      from public.agents a
      where a.id = any(chosen_agent_ids)
        and a.party_id = p_party_id
        and not a.is_default
    ) then
      raise exception 'Every split agent must be a named agent in this party';
    end if;
    select chosen.id into coordinator_agent_id
    from unnest(chosen_agent_ids) with ordinality as chosen(id, position)
    join public.agents a on a.id = chosen.id
    where a.provider <> 'cursor'
    order by chosen.position
    limit 1;
    if coordinator_agent_id is null then
      raise exception 'Automatic splits need at least one Claude or Codex coordinator';
    end if;
    p_assigned_agent_id := coordinator_agent_id;
  elsif p_assigned_agent_id is not null and not exists (
    select 1 from public.agents a
    where a.id = p_assigned_agent_id and a.party_id = p_party_id and not a.is_default
  ) then
    raise exception 'Agent does not belong to this party';
  end if;

  insert into public.tasks (
    party_id, created_by, assigned_agent_id, project_id, title, description,
    priority, status, task_kind, split_agent_ids
  ) values (
    p_party_id, current_user_id, p_assigned_agent_id, p_project_id,
    trim(p_title), trim(coalesce(p_description, '')), p_priority, 'queued',
    case when p_auto_split then 'planner' else 'work' end,
    case when p_auto_split then chosen_agent_ids else '{}'::uuid[] end
  ) returning id into new_task_id;

  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (
    p_party_id, current_user_id,
    case when p_auto_split then 'task_split_requested' else 'task_created' end,
    jsonb_build_object('task_id', new_task_id, 'title', trim(p_title))
  );

  return new_task_id;
end;
$$;

revoke all on function public.create_crew_task(uuid, text, text, text, uuid, uuid, boolean, uuid[]) from public, anon;
grant execute on function public.create_crew_task(uuid, text, text, text, uuid, uuid, boolean, uuid[]) to authenticated;

drop function public.claim_next_task(uuid, uuid, jsonb, text, integer);
create function public.claim_next_task(
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
  task_kind text,
  split_agents jsonb,
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
  target_split_agents jsonb := '[]'::jsonb;
begin
  if coalesce((select auth.jwt() ->> 'connector') = 'true', false) is not true then
    raise exception 'Connector authentication required';
  end if;
  if jsonb_typeof(p_capabilities) <> 'array' then raise exception 'Capabilities must be an array'; end if;
  if char_length(p_idempotency_key) not between 8 and 200 then raise exception 'Invalid idempotency key'; end if;
  p_lease_seconds := greatest(30, least(p_lease_seconds, 300));

  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and ds.revoked_at is null
    and ds.expires_at > now()
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  if p_agent_id is not null and not exists (
    select 1 from public.agents a
    where a.id = p_agent_id and a.device_id = p_device_id and a.party_id = current_session.party_id
  ) then raise exception 'Agent does not belong to this device'; end if;

  select t.* into target_task
  from public.tasks t
  left join public.device_folders df
    on df.project_id = t.project_id and df.device_id = p_device_id and df.enabled = true
  where t.party_id = current_session.party_id
    and t.status = 'queued'
    and (t.assigned_device_id is null or t.assigned_device_id = p_device_id)
    and (t.assigned_agent_id is null or t.assigned_agent_id = p_agent_id)
    and (t.project_id is null or df.id is not null)
    and p_capabilities @> t.required_capabilities
  order by
    case t.priority when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
    t.created_at
  limit 1
  for update of t skip locked;
  if not found then return; end if;

  if target_task.project_id is not null then
    select df.id into target_folder_id from public.device_folders df
    where df.project_id = target_task.project_id and df.device_id = p_device_id and df.enabled = true;
  end if;

  if target_task.task_kind = 'planner' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'provider', a.provider, 'model', a.model,
      'instructions', left(a.instructions, 1000)
    ) order by array_position(target_task.split_agent_ids, a.id)), '[]'::jsonb)
    into target_split_agents
    from public.agents a
    where a.id = any(target_task.split_agent_ids) and a.party_id = target_task.party_id;
  end if;

  select coalesce(max(tr.attempt), 0) + 1 into next_attempt
  from public.task_runs tr where tr.task_id = target_task.id;
  new_lease_expires_at := now() + make_interval(secs => p_lease_seconds);

  insert into public.task_runs (
    task_id, party_id, device_id, agent_id, session_id, idempotency_key, attempt, lease_expires_at
  ) values (
    target_task.id, target_task.party_id, p_device_id, p_agent_id,
    current_session.id, p_idempotency_key, next_attempt, new_lease_expires_at
  ) returning id into new_run_id;

  update public.tasks set status = 'running', assigned_device_id = p_device_id,
    assigned_agent_id = coalesce(p_agent_id, assigned_agent_id), updated_at = now()
  where id = target_task.id;

  update public.agents set status = 'working', current_task_summary = target_task.title, updated_at = now()
  where id = p_agent_id and status <> 'paused';
  update public.device_sessions set last_used_at = now() where id = current_session.id;

  return query select new_run_id, target_task.id, target_task.party_id, target_task.project_id,
    target_folder_id, target_task.title, target_task.description, target_task.priority,
    target_task.task_kind, target_split_agents, new_lease_expires_at;
end;
$$;

revoke all on function public.claim_next_task(uuid, uuid, jsonb, text, integer) from public, anon;
grant execute on function public.claim_next_task(uuid, uuid, jsonb, text, integer) to authenticated;

create or replace function public.connector_append_task_progress(
  p_device_id uuid,
  p_run_id uuid,
  p_kind text,
  p_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_run public.task_runs%rowtype;
  new_event_id bigint;
begin
  if p_kind not in ('status', 'update', 'tool', 'error') then raise exception 'Invalid progress kind'; end if;
  if char_length(trim(coalesce(p_message, ''))) not between 1 and 500 then raise exception 'Invalid progress message'; end if;
  if jsonb_typeof(p_metadata) <> 'object' then raise exception 'Progress metadata must be an object'; end if;

  select ds.* into current_session from public.device_sessions ds
  where ds.id = (select auth.uid()) and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id);
  if not found then raise exception 'Device session is inactive'; end if;

  select tr.* into target_run from public.task_runs tr
  where tr.id = p_run_id and tr.party_id = current_session.party_id
    and tr.device_id = p_device_id and tr.session_id = current_session.id
    and tr.status in ('running', 'approval_needed') and tr.lease_expires_at > now();
  if not found then raise exception 'Task run is not active'; end if;

  insert into public.task_progress_events (party_id, task_id, run_id, device_id, kind, message, metadata)
  values (target_run.party_id, target_run.task_id, target_run.id, p_device_id,
    p_kind, trim(p_message), p_metadata - 'command' - 'content' - 'prompt')
  returning id into new_event_id;

  update public.tasks set progress_summary = trim(p_message), updated_at = now()
  where id = target_run.task_id;
  return new_event_id;
end;
$$;

create or replace function public.connector_create_task_split(
  p_device_id uuid,
  p_run_id uuid,
  p_items jsonb,
  p_result_summary text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_run public.task_runs%rowtype;
  parent_task public.tasks%rowtype;
  item jsonb;
  item_agent_id uuid;
  created_count integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 2 and 12 then
    raise exception 'A split must contain between 2 and 12 tasks';
  end if;

  select ds.* into current_session from public.device_sessions ds
  where ds.id = (select auth.uid()) and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id);
  if not found then raise exception 'Device session is inactive'; end if;

  select tr.* into target_run from public.task_runs tr
  where tr.id = p_run_id and tr.party_id = current_session.party_id
    and tr.device_id = p_device_id and tr.session_id = current_session.id
    and tr.status = 'running' and tr.lease_expires_at > now()
  for update;
  if not found then raise exception 'Task run is not active'; end if;

  select t.* into parent_task from public.tasks t
  where t.id = target_run.task_id and t.task_kind = 'planner'
  for update;
  if not found then raise exception 'Task is not a split planner'; end if;

  for item in select element.value from jsonb_array_elements(p_items) as element(value)
  loop
    begin item_agent_id := (item ->> 'agent_id')::uuid;
    exception when others then raise exception 'Every split item needs a valid agent_id'; end;
    if not item_agent_id = any(parent_task.split_agent_ids) then
      raise exception 'Split item agent is not allowed';
    end if;
    if char_length(trim(coalesce(item ->> 'title', ''))) not between 1 and 160
      or char_length(coalesce(item ->> 'description', '')) > 20000 then
      raise exception 'Invalid split item';
    end if;

    insert into public.tasks (
      party_id, created_by, assigned_agent_id, project_id, title, description,
      priority, status, task_kind, parent_task_id
    ) values (
      parent_task.party_id, parent_task.created_by, item_agent_id, parent_task.project_id,
      trim(item ->> 'title'), trim(coalesce(item ->> 'description', '')),
      parent_task.priority, 'queued', 'work', parent_task.id
    );
    created_count := created_count + 1;
  end loop;

  update public.task_runs set status = 'completed', result_summary = left(coalesce(nullif(trim(p_result_summary), ''),
    'Split into ' || created_count || ' tasks'), 4000), finished_at = now()
  where id = target_run.id;
  update public.tasks set status = 'running', completed_at = null,
    progress_summary = 'Split into ' || created_count || ' tasks', updated_at = now()
  where id = parent_task.id;
  update public.agents set status = 'ready', current_task_summary = null, updated_at = now()
  where id = target_run.agent_id;

  insert into public.activity_events (party_id, event_type, metadata)
  values (parent_task.party_id, 'task_split_created',
    jsonb_build_object('task_id', parent_task.id, 'child_count', created_count));
  return created_count;
end;
$$;

create or replace function private.refresh_parent_task_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_task_id is null then return new; end if;
  update public.tasks parent
  set status = case
      when exists (select 1 from public.tasks child where child.parent_task_id = parent.id and child.status in ('failed', 'blocked', 'interrupted')) then 'blocked'
      when not exists (select 1 from public.tasks child where child.parent_task_id = parent.id and child.status <> 'completed') then 'completed'
      else 'running'
    end,
    completed_at = case
      when not exists (select 1 from public.tasks child where child.parent_task_id = parent.id and child.status <> 'completed') then now()
      else null
    end,
    progress_summary = (
      select count(*) filter (where child.status = 'completed') || '/' || count(*) || ' subtasks completed'
      from public.tasks child where child.parent_task_id = parent.id
    ),
    updated_at = now()
  where parent.id = new.parent_task_id;
  return new;
end;
$$;

create trigger tasks_refresh_parent_status
after update of status on public.tasks
for each row when (new.parent_task_id is not null and old.status is distinct from new.status)
execute function private.refresh_parent_task_status();

create or replace function public.resume_interrupted_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_task public.tasks%rowtype;
begin
  select t.* into target_task from public.tasks t where t.id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if target_task.status <> 'interrupted' then raise exception 'Task is not interrupted'; end if;
  if target_task.created_by <> current_user_id and not private.is_party_admin(target_task.party_id) then
    raise exception 'Not allowed';
  end if;
  if exists (select 1 from public.task_runs tr where tr.task_id = p_task_id and tr.status in ('running', 'approval_needed')) then
    raise exception 'Task still has an active run';
  end if;
  update public.tasks set status = 'queued', assigned_device_id = null,
    progress_summary = 'Waiting to resume', updated_at = now() where id = p_task_id;
  return true;
end;
$$;

create or replace function public.reap_expired_task_leases()
returns table(expired_approvals integer, requeued_runs integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_count integer := 0;
  run_count integer := 0;
begin
  with expired as (
    update public.approval_requests ar set status = 'expired', decided_at = now()
    where ar.status = 'pending' and ar.expires_at <= now() returning ar.run_id, ar.task_id
  ), failed_runs as (
    update public.task_runs tr set status = 'failed', error_code = 'approval_timeout', finished_at = now()
    from expired e where tr.id = e.run_id and tr.status = 'approval_needed' returning tr.task_id
  )
  update public.tasks t set status = 'failed', updated_at = now()
  from failed_runs fr where t.id = fr.task_id and t.status = 'approval_needed';
  get diagnostics approval_count = row_count;

  with expired_runs as (
    update public.task_runs tr set status = 'expired', error_code = 'lease_expired', finished_at = now()
    where tr.status in ('running', 'approval_needed') and tr.lease_expires_at <= now()
    returning tr.task_id
  ), interrupted as (
    update public.tasks t set status = 'interrupted', assigned_device_id = null,
      progress_summary = 'Device went offline — choose Resume when it is ready', updated_at = now()
    from expired_runs er where t.id = er.task_id and t.status in ('running', 'approval_needed')
    returning t.id
  )
  select count(*)::integer into run_count from interrupted;

  update public.agents a set status = 'ready', current_task_summary = null, updated_at = now()
  where a.status = 'working' and not exists (
    select 1 from public.task_runs tr where tr.agent_id = a.id and tr.status in ('running', 'approval_needed')
  );

  update public.devices d set status = 'offline'
  where d.status <> 'offline' and d.last_seen_at < now() - interval '2 minutes'
    and not exists (
      select 1 from public.device_sessions ds where ds.device_id = d.id
        and ds.revoked_at is null and ds.expires_at > now()
        and ds.last_used_at >= now() - interval '2 minutes'
    );
  return query select approval_count, run_count;
end;
$$;

revoke all on function public.connector_append_task_progress(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.connector_create_task_split(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.resume_interrupted_task(uuid) from public, anon;
grant execute on function public.connector_append_task_progress(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.connector_create_task_split(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.resume_interrupted_task(uuid) to authenticated;

drop function public.connector_claim_repository_setup(uuid);
create function public.connector_claim_repository_setup(p_device_id uuid)
returns table(
  request_id uuid, party_id uuid, name text, description text,
  source_type text, repository_url text, expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_request public.repository_setup_requests%rowtype;
begin
  select ds.* into current_session from public.device_sessions ds
  where ds.id = (select auth.uid()) and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  update public.repository_setup_requests rsr set status = 'expired', updated_at = now()
  where rsr.device_id = p_device_id and rsr.party_id = current_session.party_id
    and rsr.status = 'pending' and rsr.expires_at <= now();

  select rsr.* into target_request from public.repository_setup_requests rsr
  where rsr.device_id = p_device_id and rsr.party_id = current_session.party_id
    and rsr.status = 'pending' and rsr.expires_at > now()
  order by rsr.created_at limit 1 for update skip locked;
  if not found then return; end if;

  update public.repository_setup_requests set status = 'claimed', claimed_at = now(), updated_at = now()
  where id = target_request.id;
  return query select target_request.id, target_request.party_id, target_request.name,
    target_request.description, target_request.source_type, target_request.repository_url,
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
  if char_length(trim(p_folder_label)) not between 1 and 120 or p_path_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid repository folder';
  end if;
  select ds.* into current_session from public.device_sessions ds
  where ds.id = (select auth.uid()) and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  select rsr.* into target_request from public.repository_setup_requests rsr
  where rsr.id = p_request_id and rsr.device_id = p_device_id
    and rsr.party_id = current_session.party_id and rsr.status = 'claimed'
    and rsr.expires_at > now() for update;
  if not found then raise exception 'Repository request is inactive'; end if;

  insert into public.projects (party_id, created_by, name, description, source_type, repository_url)
  values (current_session.party_id, target_request.requested_by, target_request.name,
    target_request.description, target_request.source_type, target_request.repository_url)
  returning id into new_project_id;

  insert into public.device_folders (party_id, project_id, device_id, label, path_fingerprint)
  values (current_session.party_id, new_project_id, p_device_id, trim(p_folder_label), p_path_fingerprint);

  update public.repository_setup_requests set status = 'completed', project_id = new_project_id,
    completed_at = now(), updated_at = now() where id = p_request_id;
  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (current_session.party_id, target_request.requested_by, 'repository_added',
    jsonb_build_object('name', target_request.name, 'project_id', new_project_id,
      'source_type', target_request.source_type));
  return new_project_id;
end;
$$;

revoke all on function public.connector_claim_repository_setup(uuid) from public, anon;
grant execute on function public.connector_claim_repository_setup(uuid) to authenticated;

commit;
