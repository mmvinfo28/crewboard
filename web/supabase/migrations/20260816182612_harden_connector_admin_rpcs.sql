create index if not exists approval_requests_decided_by_idx
on public.approval_requests(decided_by);

drop policy if exists connector_receive_party_wakeups on realtime.messages;
create policy connector_receive_party_wakeups
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and coalesce(((select auth.jwt()) ->> 'connector') = 'true', false)
  and realtime.topic() = 'party:' || ((select auth.jwt()) ->> 'party_id')
  and private.is_active_connector(
    (((select auth.jwt()) ->> 'party_id'))::uuid,
    (((select auth.jwt()) ->> 'device_id'))::uuid
  )
);

create or replace function public.approve_device_pairing(
  p_code_hash bytea,
  p_party_id uuid,
  p_user_id uuid
)
returns table(pairing_id uuid, device_name text, platform text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_pairing public.device_pairings%rowtype;
begin
  if p_user_id is null or not exists (
    select 1 from public.party_members pm
    where pm.party_id = p_party_id
      and pm.user_id = p_user_id
      and pm.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Not allowed';
  end if;

  select dp.* into target_pairing
  from public.device_pairings dp
  join private.device_pairing_secrets dps on dps.pairing_id = dp.id
  where dps.code_hash = p_code_hash
    and dp.status = 'pending'
    and dp.attempts < 5
    and dp.expires_at > now()
  for update of dp;

  if not found then
    raise exception 'Pairing code is invalid or expired';
  end if;

  update public.device_pairings
  set status = 'approved',
      approved_party_id = p_party_id,
      approved_by = p_user_id,
      approved_at = now()
  where id = target_pairing.id;

  return query
    select target_pairing.id, target_pairing.device_name,
           target_pairing.platform, target_pairing.expires_at;
end;
$$;

create or replace function public.revoke_device_session(p_session_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session public.device_sessions%rowtype;
begin
  select * into target_session
  from public.device_sessions
  where id = p_session_id
  for update;

  if not found then return false; end if;
  if target_session.owner_id <> p_user_id
    and not exists (
      select 1 from public.party_members pm
      where pm.party_id = target_session.party_id
        and pm.user_id = p_user_id
        and pm.role in ('owner', 'admin')
    ) then
    raise exception 'Not allowed';
  end if;

  update public.device_sessions
  set revoked_at = coalesce(revoked_at, now())
  where id = p_session_id;

  update public.devices
  set status = 'offline'
  where id = target_session.device_id
    and not exists (
      select 1 from public.device_sessions active
      where active.device_id = target_session.device_id
        and active.id <> p_session_id
        and active.revoked_at is null
        and active.expires_at > now()
    );

  return true;
end;
$$;

revoke all on function public.approve_device_pairing(bytea, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.revoke_device_session(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.approve_device_pairing(bytea, uuid, uuid) to service_role;
grant execute on function public.revoke_device_session(uuid, uuid) to service_role;

drop function public.approve_device_pairing(bytea, uuid);
drop function public.revoke_device_session(uuid);
