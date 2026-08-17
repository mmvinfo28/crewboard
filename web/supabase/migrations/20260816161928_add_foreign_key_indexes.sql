create index activity_events_actor_idx on public.activity_events(actor_id);
create index agents_device_idx on public.agents(device_id);
create index parties_created_by_idx on public.parties(created_by);
create index tasks_created_by_idx on public.tasks(created_by);
