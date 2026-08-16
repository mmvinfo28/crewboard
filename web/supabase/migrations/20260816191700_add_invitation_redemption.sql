create or replace function public.redeem_party_invitation(
  p_code_hash bytea,
  p_user_id uuid
)
returns table(party_id uuid, party_name text, membership_role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.invitations%rowtype;
  inserted_count integer := 0;
begin
  if p_user_id is null then raise exception 'Authentication required'; end if;

  select * into invite
  from public.invitations
  where code_hash = p_code_hash
  for update;

  if invite.id is null
    or invite.revoked_at is not null
    or invite.expires_at <= now()
    or invite.use_count >= invite.max_uses
  then
    raise exception 'Invitation is invalid or expired';
  end if;

  insert into public.party_members (party_id, user_id, role)
  values (invite.party_id, p_user_id, invite.role)
  on conflict (party_id, user_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.invitations
    set use_count = use_count + 1
    where id = invite.id;

    insert into public.activity_events (party_id, actor_id, event_type, metadata)
    values (invite.party_id, p_user_id, 'person_joined', jsonb_build_object('role', invite.role));
  end if;

  return query
  select parties.id, parties.name, invite.role
  from public.parties
  where parties.id = invite.party_id;
end;
$$;

revoke all on function public.redeem_party_invitation(bytea, uuid) from public, anon, authenticated;
grant execute on function public.redeem_party_invitation(bytea, uuid) to service_role;
