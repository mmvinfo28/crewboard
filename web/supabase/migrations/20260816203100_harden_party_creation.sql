create or replace function private.is_party_creator(target_party uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.parties
    where id = target_party and created_by = (select auth.uid())
  );
$$;

revoke all on function private.is_party_creator(uuid) from public, anon;
grant execute on function private.is_party_creator(uuid) to authenticated;

drop policy if exists "members_insert_creator_or_admin" on public.party_members;
create policy "members_insert_creator_or_admin"
on public.party_members
for insert
to authenticated
with check (
  private.is_party_admin(party_id)
  or (user_id = (select auth.uid()) and private.is_party_creator(party_id))
);

create or replace function public.create_party(party_name text, party_slug text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_party_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(party_name)) not between 1 and 100 then raise exception 'Party name must contain between 1 and 100 characters'; end if;
  if party_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Invalid party slug'; end if;

  insert into public.profiles (id, display_name)
  select users.id, coalesce(nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''), split_part(users.email, '@', 1), 'Member')
  from auth.users as users
  where users.id = current_user_id
  on conflict (id) do nothing;

  insert into public.parties (name, slug, created_by)
  values (trim(party_name), party_slug, current_user_id)
  returning id into new_party_id;

  insert into public.party_members (party_id, user_id, role)
  values (new_party_id, current_user_id, 'owner');
  return new_party_id;
end;
$$;
