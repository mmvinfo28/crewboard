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

revoke all on function public.connector_rotate_session(bytea, bytea, text)
from public, anon, authenticated;
grant execute on function public.connector_rotate_session(bytea, bytea, text)
to service_role;
