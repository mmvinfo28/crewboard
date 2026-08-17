begin;

create or replace function public.retry_failed_task(p_task_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_task public.tasks%rowtype;
begin
  select t.* into target_task
  from public.tasks t
  where t.id = p_task_id
  for update;

  if not found then
    raise exception 'Task not found';
  end if;
  if target_task.status <> 'failed' then
    raise exception 'Only failed tasks can be retried';
  end if;
  if target_task.created_by <> current_user_id
    and not private.is_party_admin(target_task.party_id) then
    raise exception 'Not allowed';
  end if;
  if exists (
    select 1 from public.task_runs tr
    where tr.task_id = p_task_id
      and tr.status in ('running', 'approval_needed')
  ) then
    raise exception 'Task still has an active run';
  end if;

  update public.tasks
  set status = 'queued',
      assigned_device_id = null,
      completed_at = null,
      progress_summary = 'Queued for retry',
      updated_at = now()
  where id = p_task_id;

  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (
    target_task.party_id,
    current_user_id,
    'task_retried',
    jsonb_build_object('task_id', target_task.id, 'title', target_task.title)
  );

  return true;
end;
$$;

revoke all on function public.retry_failed_task(uuid) from public, anon;
grant execute on function public.retry_failed_task(uuid) to authenticated;

commit;
