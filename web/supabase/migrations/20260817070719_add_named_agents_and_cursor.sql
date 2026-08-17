alter table public.agents drop constraint if exists agents_provider_check;
alter table public.agents
  add constraint agents_provider_check
  check (provider in ('claude', 'codex', 'cursor', 'gemini', 'custom'));

alter table public.agents
  add column instructions text not null default ''
    check (char_length(instructions) <= 8000),
  add column context_window_tokens integer
    check (context_window_tokens is null or context_window_tokens between 1 and 10000000),
  add column is_default boolean not null default false;

-- Existing rows were created by connector discovery and are provider defaults.
update public.agents set is_default = true;

drop index if exists public.agents_device_provider_unique_idx;
create unique index agents_device_provider_default_unique_idx
  on public.agents(device_id, provider)
  where is_default and device_id is not null;

drop function public.connector_register_agents(uuid, jsonb);

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
  status text,
  instructions text,
  context_window_tokens integer,
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
      capabilities, is_default
    ) values (
      current_session.party_id,
      p_device_id,
      current_session.owner_id,
      trim(agent_value ->> 'name'),
      agent_value ->> 'provider',
      trim(agent_value ->> 'model'),
      'ready',
      agent_capabilities,
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
