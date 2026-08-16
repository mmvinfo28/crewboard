revoke insert on public.repository_setup_requests from authenticated;
grant insert (party_id, device_id, requested_by, name, description)
on public.repository_setup_requests to authenticated;

alter table public.repository_setup_requests
add constraint repository_setup_requests_expiry_window_check
check (
  expires_at > created_at
  and expires_at <= created_at + interval '10 minutes'
);

create or replace function private.expire_old_repository_setup_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.repository_setup_requests rsr
  set status = 'expired', updated_at = now()
  where rsr.device_id = new.device_id
    and rsr.status in ('pending', 'claimed')
    and rsr.expires_at <= now();
  return new;
end;
$$;

create trigger repository_setup_requests_expire_before_insert
before insert on public.repository_setup_requests
for each row execute function private.expire_old_repository_setup_requests();
