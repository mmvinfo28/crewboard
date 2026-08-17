alter table public.devices
  add column if not exists removed_at timestamptz;

comment on column public.devices.removed_at is
  'When set, the device is disconnected and hidden from the active Crewboard UI while run history is preserved.';

create index if not exists devices_party_active_idx
  on public.devices(party_id, created_at)
  where removed_at is null;

create or replace function public.remove_device(p_device_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_device public.devices%rowtype;
begin
  select * into target_device
  from public.devices
  where id = p_device_id
    and removed_at is null
  for update;

  if not found then return false; end if;

  if target_device.owner_id <> p_user_id
    and not exists (
      select 1
      from public.party_members pm
      where pm.party_id = target_device.party_id
        and pm.user_id = p_user_id
        and pm.role in ('owner', 'admin')
    ) then
    raise exception 'Not allowed';
  end if;

  update public.device_sessions
  set revoked_at = coalesce(revoked_at, now())
  where device_id = target_device.id;

  update public.devices
  set status = 'offline',
      removed_at = now()
  where id = target_device.id;

  delete from public.repository_setup_requests where device_id = target_device.id;
  delete from public.device_folders where device_id = target_device.id;
  delete from public.provider_account_usage where device_id = target_device.id;
  delete from public.agents where device_id = target_device.id;

  return true;
end;
$$;

revoke all on function public.remove_device(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_device(uuid, uuid) to service_role;
