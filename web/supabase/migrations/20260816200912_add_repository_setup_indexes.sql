create index repository_setup_requests_party_idx
on public.repository_setup_requests(party_id);

create index repository_setup_requests_project_idx
on public.repository_setup_requests(project_id)
where project_id is not null;

create index repository_setup_requests_requested_by_idx
on public.repository_setup_requests(requested_by);
