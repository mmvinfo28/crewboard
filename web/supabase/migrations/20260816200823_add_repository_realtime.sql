do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then alter publication supabase_realtime add table public.projects; end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_folders'
  ) then alter publication supabase_realtime add table public.device_folders; end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'repository_setup_requests'
  ) then alter publication supabase_realtime add table public.repository_setup_requests; end if;
end
$$;
