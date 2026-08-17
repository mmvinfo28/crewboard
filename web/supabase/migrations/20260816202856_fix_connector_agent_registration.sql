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
#variable_conflict use_column
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

  for agent_value in select element.value from jsonb_array_elements(p_agents) as element(value)
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

    insert into public.agents as target (
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
        status = case when target.status = 'paused' then 'paused' else 'ready' end,
        updated_at = now()
    returning target.* into registered_agent;

    return query select
      registered_agent.id,
      registered_agent.provider,
      registered_agent.name,
      registered_agent.model,
      registered_agent.capabilities,
      registered_agent.status;
  end loop;

  update public.agents as stale_agent
  set status = 'offline', updated_at = now()
  where stale_agent.device_id = p_device_id
    and stale_agent.provider not in (
      select element.value ->> 'provider'
      from jsonb_array_elements(p_agents) as element(value)
    );
end;
$$;

revoke all on function public.connector_register_agents(uuid, jsonb) from public, anon;
grant execute on function public.connector_register_agents(uuid, jsonb) to authenticated;
