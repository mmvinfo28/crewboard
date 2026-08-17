create or replace function public.create_named_agent(
  p_device_id uuid,
  p_name text,
  p_provider text,
  p_model text,
  p_instructions text default '',
  p_context_window_tokens integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_device public.devices%rowtype;
  new_agent_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 100 then raise exception 'Agent name must be between 1 and 100 characters'; end if;
  if p_provider not in ('claude', 'codex', 'cursor') then raise exception 'Unsupported agent provider'; end if;
  if char_length(trim(coalesce(p_model, ''))) not between 1 and 100 then raise exception 'Choose a model'; end if;
  if char_length(coalesce(p_instructions, '')) > 8000 then raise exception 'Instructions are too long'; end if;
  if p_context_window_tokens is not null and p_context_window_tokens not between 1 and 10000000 then raise exception 'Invalid context window'; end if;

  select d.* into target_device
  from public.devices d
  where d.id = p_device_id
    and d.owner_id = current_user_id
    and private.is_party_member(d.party_id);
  if not found then raise exception 'You can only add agents to your own connected computer'; end if;

  if not exists (
    select 1 from public.agents a
    where a.device_id = p_device_id
      and a.provider = p_provider
      and a.is_default
  ) then raise exception 'That AI tool has not been detected on this computer'; end if;

  if (
    select count(*) from public.agents a
    where a.device_id = p_device_id and a.owner_id = current_user_id and not a.is_default
  ) >= 24 then raise exception 'This computer already has the maximum number of named agents'; end if;

  insert into public.agents (
    party_id, device_id, owner_id, name, provider, model, status,
    capabilities, instructions, context_window_tokens, is_default
  ) values (
    target_device.party_id,
    target_device.id,
    current_user_id,
    trim(p_name),
    p_provider,
    trim(p_model),
    case
      when target_device.status = 'online'
        and target_device.last_seen_at > now() - interval '90 seconds'
      then 'ready'
      else 'offline'
    end,
    '["text", "code", "filesystem"]'::jsonb,
    trim(coalesce(p_instructions, '')),
    p_context_window_tokens,
    false
  ) returning id into new_agent_id;

  insert into public.activity_events (party_id, actor_id, event_type, metadata)
  values (
    target_device.party_id,
    current_user_id,
    'agent_created',
    jsonb_build_object('agent_id', new_agent_id, 'name', trim(p_name), 'provider', p_provider, 'model', trim(p_model))
  );

  return new_agent_id;
end;
$$;

revoke all on function public.create_named_agent(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.create_named_agent(uuid, text, text, text, text, integer) to authenticated;
