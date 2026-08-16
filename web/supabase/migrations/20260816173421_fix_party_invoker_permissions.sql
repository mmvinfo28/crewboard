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

  insert into public.parties (name, slug, created_by)
  values (trim(party_name), party_slug, current_user_id)
  returning id into new_party_id;

  insert into public.party_members (party_id, user_id, role)
  values (new_party_id, current_user_id, 'owner');
  return new_party_id;
end;
$$;
