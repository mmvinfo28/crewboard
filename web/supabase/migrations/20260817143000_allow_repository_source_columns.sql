grant insert (
  party_id,
  device_id,
  requested_by,
  name,
  description,
  source_type,
  repository_url
)
on public.repository_setup_requests
to authenticated;
