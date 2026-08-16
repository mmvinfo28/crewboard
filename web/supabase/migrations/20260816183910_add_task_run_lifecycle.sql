begin;

-- Refresh-token rotation invalidates every older access token immediately rather
-- than waiting for its five-minute JWT expiry.
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
        and ds.party_id = nullif((select auth.jwt() ->> 'party_id'), '')::uuid
        and ds.device_id = nullif((select auth.jwt() ->> 'device_id'), '')::uuid
        and (target_device is null or ds.device_id = target_device)
        and ds.token_generation = nullif((select auth.jwt() ->> 'token_generation'), '')::integer
        and ds.revoked_at is null
        and ds.expires_at > now()
    );
$$;

create unique index approval_requests_one_pending_per_run_idx
on public.approval_requests(run_id)
where status = 'pending';

create or replace function public.request_task_approval(
  p_device_id uuid,
  p_run_id uuid,
  p_kind text,
  p_manifest jsonb,
  p_expires_seconds integer default 300
)
returns table(
  approval_id uuid,
  status text,
  manifest_hash text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_run public.task_runs%rowtype;
  existing_request public.approval_requests%rowtype;
  computed_hash text;
  new_approval_id uuid;
  approval_expires_at timestamptz;
begin
  if p_kind not in ('launch', 'shell', 'write', 'network') then
    raise exception 'Invalid approval kind';
  end if;
  if jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'Approval manifest must be an object';
  end if;

  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  select tr.* into target_run
  from public.task_runs tr
  where tr.id = p_run_id
    and tr.party_id = current_session.party_id
    and tr.device_id = p_device_id
    and tr.session_id = current_session.id
    and tr.status = 'running'
    and tr.lease_expires_at > now()
  for update;
  if not found then raise exception 'Task run is not active'; end if;

  computed_hash := encode(extensions.digest(convert_to(p_manifest::text, 'UTF8'), 'sha256'), 'hex');

  select ar.* into existing_request
  from public.approval_requests ar
  where ar.run_id = target_run.id and ar.status = 'pending'
  for update;
  if found then
    if existing_request.manifest_hash <> computed_hash or existing_request.kind <> p_kind then
      raise exception 'A different approval is already pending';
    end if;
    return query select existing_request.id, existing_request.status,
      existing_request.manifest_hash, existing_request.expires_at;
    return;
  end if;

  p_expires_seconds := greatest(60, least(p_expires_seconds, 900));
  approval_expires_at := now() + make_interval(secs => p_expires_seconds);

  insert into public.approval_requests (
    party_id, task_id, run_id, device_id, requested_by_session_id,
    kind, manifest, manifest_hash, expires_at
  ) values (
    target_run.party_id, target_run.task_id, target_run.id, target_run.device_id,
    current_session.id, p_kind, p_manifest, computed_hash, approval_expires_at
  ) returning id into new_approval_id;

  update public.task_runs
  set status = 'approval_needed'
  where id = target_run.id;

  update public.tasks
  set status = 'approval_needed', updated_at = now()
  where id = target_run.task_id;

  insert into public.activity_events (party_id, event_type, metadata)
  values (
    target_run.party_id,
    'approval.requested',
    jsonb_build_object('approval_id', new_approval_id, 'task_id', target_run.task_id,
      'run_id', target_run.id, 'kind', p_kind)
  );

  return query select new_approval_id, 'pending'::text, computed_hash, approval_expires_at;
end;
$$;

create or replace function public.decide_task_approval(
  p_approval_id uuid,
  p_decision text
)
returns table(
  approval_id uuid,
  status text,
  run_id uuid,
  task_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  deciding_user uuid := (select auth.uid());
  target_approval public.approval_requests%rowtype;
  target_run public.task_runs%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select ar.* into target_approval
  from public.approval_requests ar
  where ar.id = p_approval_id
  for update;
  if not found then raise exception 'Approval request not found'; end if;

  if not exists (
    select 1
    from public.tasks t
    join public.party_members pm on pm.party_id = t.party_id and pm.user_id = deciding_user
    where t.id = target_approval.task_id
      and (pm.role in ('owner', 'admin') or t.created_by = deciding_user)
  ) then
    raise exception 'Not allowed';
  end if;
  if target_approval.status <> 'pending' then raise exception 'Approval is already decided'; end if;
  if target_approval.expires_at <= now() then raise exception 'Approval has expired'; end if;

  select tr.* into target_run
  from public.task_runs tr
  where tr.id = target_approval.run_id
    and tr.status = 'approval_needed'
    and tr.lease_expires_at > now()
  for update;
  if not found then raise exception 'Task run is no longer active'; end if;

  update public.approval_requests
  set status = p_decision,
      decided_by = deciding_user,
      decided_at = now()
  where id = target_approval.id;

  if p_decision = 'approved' then
    update public.task_runs
    set status = 'running', lease_expires_at = now() + interval '90 seconds'
    where id = target_run.id;
    update public.tasks set status = 'running', updated_at = now()
    where id = target_run.task_id;
  else
    update public.task_runs
    set status = 'failed', error_code = 'approval_rejected', finished_at = now()
    where id = target_run.id;
    update public.tasks set status = 'failed', updated_at = now()
    where id = target_run.task_id;
  end if;

  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (
    target_approval.party_id,
    deciding_user,
    'approval.' || p_decision,
    jsonb_build_object('approval_id', target_approval.id, 'task_id', target_run.task_id,
      'run_id', target_run.id)
  );

  return query select target_approval.id, p_decision, target_run.id, target_run.task_id;
end;
$$;

create or replace function public.complete_task_run(
  p_device_id uuid,
  p_run_id uuid,
  p_status text,
  p_result_summary text default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  target_run public.task_runs%rowtype;
begin
  if p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'Invalid final status';
  end if;
  if p_result_summary is not null and char_length(p_result_summary) > 4000 then
    raise exception 'Result summary is too long';
  end if;
  if p_error_code is not null and char_length(p_error_code) > 120 then
    raise exception 'Error code is too long';
  end if;

  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  select tr.* into target_run
  from public.task_runs tr
  where tr.id = p_run_id
    and tr.party_id = current_session.party_id
    and tr.device_id = p_device_id
    and tr.session_id = current_session.id
    and (
      tr.status = 'running'
      or (tr.status = 'approval_needed' and p_status = 'cancelled')
    )
  for update;
  if not found then raise exception 'Task run is not active'; end if;

  update public.approval_requests
  set status = 'cancelled', decided_at = now()
  where run_id = target_run.id and status = 'pending';

  update public.task_runs
  set status = p_status,
      result_summary = nullif(trim(p_result_summary), ''),
      error_code = nullif(trim(p_error_code), ''),
      finished_at = now()
  where id = target_run.id;

  update public.tasks
  set status = p_status,
      completed_at = case when p_status = 'completed' then now() else null end,
      updated_at = now()
  where id = target_run.task_id;

  if target_run.agent_id is not null then
    update public.agents
    set status = 'ready', current_task_summary = null, updated_at = now()
    where id = target_run.agent_id;
  end if;

  insert into public.activity_events (party_id, event_type, metadata)
  values (
    target_run.party_id,
    'task.' || p_status,
    jsonb_build_object('task_id', target_run.task_id, 'run_id', target_run.id,
      'device_id', target_run.device_id, 'error_code', p_error_code)
  );

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
    update public.approval_requests ar
    set status = 'expired', decided_at = now()
    where ar.status = 'pending' and ar.expires_at <= now()
    returning ar.run_id, ar.task_id
  ), failed_runs as (
    update public.task_runs tr
    set status = 'failed', error_code = 'approval_timeout', finished_at = now()
    from expired e
    where tr.id = e.run_id and tr.status = 'approval_needed'
    returning tr.task_id
  )
  update public.tasks t
  set status = 'failed', updated_at = now()
  from failed_runs fr
  where t.id = fr.task_id and t.status = 'approval_needed';
  get diagnostics approval_count = row_count;

  with expired_runs as (
    update public.task_runs tr
    set status = 'expired', error_code = 'lease_expired', finished_at = now()
    where tr.status in ('running', 'approval_needed')
      and tr.lease_expires_at <= now()
    returning tr.task_id
  ), requeued as (
    update public.tasks t
    set status = 'queued',
        assigned_device_id = null,
        updated_at = now()
    from expired_runs er
    where t.id = er.task_id and t.status in ('running', 'approval_needed')
    returning t.id
  )
  select count(*)::integer into run_count from requeued;

  update public.devices d
  set status = 'offline'
  where d.status <> 'offline'
    and d.last_seen_at < now() - interval '2 minutes'
    and not exists (
      select 1 from public.device_sessions ds
      where ds.device_id = d.id
        and ds.revoked_at is null
        and ds.expires_at > now()
        and ds.last_used_at >= now() - interval '2 minutes'
    );

  return query select approval_count, run_count;
end;
$$;

revoke all on function public.request_task_approval(uuid, uuid, text, jsonb, integer)
from public, anon;
revoke all on function public.decide_task_approval(uuid, text)
from public, anon;
revoke all on function public.complete_task_run(uuid, uuid, text, text, text)
from public, anon;
revoke all on function public.reap_expired_task_leases()
from public, anon, authenticated;

grant execute on function public.request_task_approval(uuid, uuid, text, jsonb, integer)
to authenticated;
grant execute on function public.decide_task_approval(uuid, text)
to authenticated;
grant execute on function public.complete_task_run(uuid, uuid, text, text, text)
to authenticated;
grant execute on function public.reap_expired_task_leases()
to service_role;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'crewboard-reap-task-leases';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'crewboard-reap-task-leases',
    '* * * * *',
    $cron$select public.reap_expired_task_leases();$cron$
  );
end;
$$;

commit;
