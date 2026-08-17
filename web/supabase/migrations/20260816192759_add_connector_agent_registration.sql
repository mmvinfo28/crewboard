create unique index if not exists agents_device_provider_unique_idx
on public.agents(device_id, provider);

create or replace function public.connector_register_agents(
  p_device_id uuid,
  p_agents jsonb
)
returns table(
  agent_id uuid,
  provider text,
  name text,
  model text,
  capabilities jsonb,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  agent_value jsonb;
  registered_agent public.agents%rowtype;
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

  for agent_value in select value from jsonb_array_elements(p_agents)
  loop
    if jsonb_typeof(agent_value) <> 'object'
      or agent_value ->> 'provider' not in ('claude', 'codex', 'gemini', 'custom')
      or char_length(trim(coalesce(agent_value ->> 'name', ''))) not between 1 and 100
      or char_length(trim(coalesce(agent_value ->> 'model', ''))) not between 1 and 100
    then
      raise exception 'Invalid agent description';
    end if;

    agent_capabilities := coalesce(agent_value -> 'capabilities', '["text", "code"]'::jsonb);
    if jsonb_typeof(agent_capabilities) <> 'array' then
      raise exception 'Agent capabilities must be an array';
    end if;

    insert into public.agents (
      party_id, device_id, owner_id, name, provider, model, status, capabilities
    ) values (
      current_session.party_id,
      p_device_id,
      current_session.owner_id,
      trim(agent_value ->> 'name'),
      agent_value ->> 'provider',
      trim(agent_value ->> 'model'),
      'ready',
      agent_capabilities
    )
    on conflict (device_id, provider) do update
    set party_id = excluded.party_id,
        owner_id = excluded.owner_id,
        name = excluded.name,
        model = excluded.model,
        capabilities = excluded.capabilities,
        status = case when public.agents.status = 'paused' then 'paused' else 'ready' end,
        updated_at = now()
    returning * into registered_agent;

    return query select
      registered_agent.id,
      registered_agent.provider,
      registered_agent.name,
      registered_agent.model,
      registered_agent.capabilities,
      registered_agent.status;
  end loop;

  update public.agents
  set status = 'offline', updated_at = now()
  where device_id = p_device_id
    and provider not in (
      select value ->> 'provider' from jsonb_array_elements(p_agents)
    );
end;
$$;

create or replace function public.connector_record_usage(
  p_device_id uuid,
  p_agent_id uuid,
  p_task_id uuid,
  p_provider text,
  p_model text,
  p_duration_ms integer,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_cached_input_tokens integer default 0,
  p_cost_usd numeric default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session public.device_sessions%rowtype;
  new_event_id bigint;
begin
  select ds.* into current_session
  from public.device_sessions ds
  where ds.id = (select auth.uid())
    and ds.device_id = p_device_id
    and private.is_active_connector(ds.party_id, p_device_id);
  if not found then raise exception 'Device session is inactive'; end if;

  if not exists (
    select 1 from public.agents a
    where a.id = p_agent_id
      and a.device_id = p_device_id
      and a.party_id = current_session.party_id
  ) then raise exception 'Agent does not belong to this device'; end if;

  if not exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.party_id = current_session.party_id
  ) then raise exception 'Task does not belong to this party'; end if;

  insert into public.usage_events (
    party_id, actor_id, agent_id, task_id, device_id, provider, model,
    input_tokens, output_tokens, cached_input_tokens, cost_usd, duration_ms
  ) values (
    current_session.party_id, current_session.owner_id, p_agent_id, p_task_id,
    p_device_id, left(trim(p_provider), 40), left(trim(p_model), 100),
    greatest(p_input_tokens, 0), greatest(p_output_tokens, 0),
    greatest(p_cached_input_tokens, 0), greatest(p_cost_usd, 0),
    greatest(p_duration_ms, 0)
  ) returning id into new_event_id;

  return new_event_id;
end;
$$;

revoke all on function public.connector_register_agents(uuid, jsonb) from public, anon;
revoke all on function public.connector_record_usage(uuid, uuid, uuid, text, text, integer, integer, integer, integer, numeric) from public, anon;
grant execute on function public.connector_register_agents(uuid, jsonb) to authenticated;
grant execute on function public.connector_record_usage(uuid, uuid, uuid, text, text, integer, integer, integer, integer, numeric) to authenticated;
