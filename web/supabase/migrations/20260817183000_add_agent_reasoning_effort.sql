begin;

alter table public.agents
  add column reasoning_effort text not null default 'medium'
  check (reasoning_effort in ('auto', 'low', 'medium', 'high', 'xhigh', 'max'));

update public.agents
set reasoning_effort = 'auto'
where is_default or provider = 'cursor';

create or replace function public.create_named_agent(
  p_device_id uuid,
  p_name text,
  p_provider text,
  p_model text,
  p_instructions text,
  p_context_window_tokens integer,
  p_reasoning_effort text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_agent_id uuid;
  normalized_effort text;
begin
  normalized_effort := case
    when p_provider = 'cursor' then 'auto'
    else lower(trim(coalesce(p_reasoning_effort, 'medium')))
  end;

  if normalized_effort not in ('auto', 'low', 'medium', 'high', 'xhigh', 'max') then
    raise exception 'Invalid reasoning effort';
  end if;
  if p_provider in ('claude', 'codex') and normalized_effort = 'auto' then
    normalized_effort := 'medium';
  end if;

  new_agent_id := public.create_named_agent(
    p_device_id,
    p_name,
    p_provider,
    p_model,
    p_instructions,
    p_context_window_tokens
  );

  update public.agents
  set reasoning_effort = normalized_effort,
      updated_at = now()
  where id = new_agent_id;

  return new_agent_id;
end;
$$;

revoke all on function public.create_named_agent(uuid, text, text, text, text, integer, text) from public, anon;
grant execute on function public.create_named_agent(uuid, text, text, text, text, integer, text) to authenticated;

drop function public.connector_register_agents(uuid, jsonb);

create function public.connector_register_agents(
  p_device_id uuid,
  p_agents jsonb
)
returns table(
  agent_id uuid,
  provider text,
  name text,
  model text,
  capabilities jsonb,
  status text,
  instructions text,
  context_window_tokens integer,
  reasoning_effort text,
  is_default boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_session public.device_sessions%rowtype;
  agent_value jsonb;
  agent_capabilities jsonb;
begin
  if jsonb_typeof(p_agents) <> 'array' or jsonb_array_length(p_agents) > 8 then
    raise exception 'Agents must be an array containing at most 8 items';
  end if;

  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id)
  for update;
  if not found then raise exception 'Device session is inactive'; end if;

  for agent_value in select element.value from jsonb_array_elements(p_agents) as element(value)
  loop
    if jsonb_typeof(agent_value) <> 'object'
      or agent_value ->> 'provider' not in ('claude', 'codex', 'cursor', 'gemini', 'custom')
      or char_length(trim(coalesce(agent_value ->> 'name', ''))) not between 1 and 100
      or char_length(trim(coalesce(agent_value ->> 'model', ''))) not between 1 and 100
    then
      raise exception 'Invalid agent description';
    end if;

    agent_capabilities := coalesce(agent_value -> 'capabilities', '["text", "code"]'::jsonb);
    if jsonb_typeof(agent_capabilities) <> 'array' then
      raise exception 'Agent capabilities must be an array';
    end if;

    insert into public.agents as target (
      party_id, device_id, owner_id, name, provider, model, status,
      capabilities, reasoning_effort, is_default
    ) values (
      current_session.party_id,
      p_device_id,
      current_session.owner_id,
      trim(agent_value ->> 'name'),
      agent_value ->> 'provider',
      trim(agent_value ->> 'model'),
      'ready',
      agent_capabilities,
      'auto',
      true
    )
    on conflict (device_id, provider) where is_default and device_id is not null do update
    set party_id = excluded.party_id,
        owner_id = excluded.owner_id,
        name = excluded.name,
        model = excluded.model,
        capabilities = excluded.capabilities,
        status = case when target.status = 'paused' then 'paused' else 'ready' end,
        updated_at = now();
  end loop;

  update public.agents as device_agent
  set status = case
        when device_agent.provider in (
          select element.value ->> 'provider'
          from jsonb_array_elements(p_agents) as element(value)
        ) then case when device_agent.status = 'paused' then 'paused' else 'ready' end
        else 'offline'
      end,
      updated_at = now()
  where device_agent.device_id = p_device_id;

  return query
  select
    device_agent.id,
    device_agent.provider,
    device_agent.name,
    device_agent.model,
    device_agent.capabilities,
    device_agent.status,
    device_agent.instructions,
    device_agent.context_window_tokens,
    device_agent.reasoning_effort,
    device_agent.is_default
  from public.agents as device_agent
  where device_agent.device_id = p_device_id
    and device_agent.provider in (
      select element.value ->> 'provider'
      from jsonb_array_elements(p_agents) as element(value)
    )
  order by device_agent.is_default desc, device_agent.created_at;
end;
$$;

revoke all on function public.connector_register_agents(uuid, jsonb) from public, anon;
grant execute on function public.connector_register_agents(uuid, jsonb) to authenticated;

commit;
