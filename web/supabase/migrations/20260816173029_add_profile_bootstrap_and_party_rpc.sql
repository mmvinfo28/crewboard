create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (id, display_name)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'display_name'), ''), split_part(users.email, '@', 1), 'Member')
from auth.users
on conflict (id) do nothing;

create or replace function public.create_party(party_name text, party_slug text)
returns uuid
language plpgsql
security definer
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
  from auth.users as users where users.id = current_user_id
  on conflict (id) do nothing;

  insert into public.parties (name, slug, created_by)
  values (trim(party_name), party_slug, current_user_id)
  returning id into new_party_id;

  insert into public.party_members (party_id, user_id, role)
  values (new_party_id, current_user_id, 'owner');
  return new_party_id;
end;
$$;

revoke all on function public.create_party(text, text) from public, anon;
grant execute on function public.create_party(text, text) to authenticated;
