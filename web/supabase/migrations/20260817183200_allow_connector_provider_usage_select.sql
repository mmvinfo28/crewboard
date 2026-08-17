begin;

drop policy if exists provider_account_usage_select_members
on public.provider_account_usage;

create policy provider_account_usage_select_party_or_connector
on public.provider_account_usage
for select to authenticated
using (
  private.is_party_member(party_id)
  or private.is_active_connector(party_id, device_id)
);

commit;
