-- Patient access RPCs must validate that the target patient belongs to the
-- target business. Otherwise an owner/admin can get a positive authorization
-- answer for an unrelated patient id, and the app later fails with a confusing
-- empty table read.

create or replace function public.user_can_read_basic_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
			select 1
			from patients p
			where p.business_id = target_business_id
				and p.id = target_patient_id
		)
		and case
			when public.user_business_role(target_business_id) in ('owner','admin')
				then public.business_allows_owner_restricted_read(target_business_id)
			when public.user_business_role(target_business_id) in ('reception','readonly')
				then public.business_allows_operation(target_business_id)
			when public.user_business_role(target_business_id) = 'professional'
				then public.business_allows_operation(target_business_id)
					and public.user_has_active_professional_patient_link(target_business_id, target_patient_id)
			else false
		end;
$$;

create or replace function public.user_can_read_clinical_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
			select 1
			from patients p
			where p.business_id = target_business_id
				and p.id = target_patient_id
		)
		and public.business_allows_operation(target_business_id)
		and (
			public.user_business_role(target_business_id) in ('owner','admin')
			or (
				public.user_business_role(target_business_id) = 'professional'
				and public.user_has_active_professional_patient_link(target_business_id, target_patient_id)
			)
		);
$$;

create or replace function public.user_can_read_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_can_read_basic_patient(target_business_id, target_patient_id);
$$;

create or replace function public.user_can_read_radiology_reference(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_can_read_clinical_patient(target_business_id, target_patient_id);
$$;

revoke execute on function public.user_can_read_basic_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_clinical_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_radiology_reference(uuid, uuid) from public, anon;

grant execute on function public.user_can_read_basic_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_clinical_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_radiology_reference(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
