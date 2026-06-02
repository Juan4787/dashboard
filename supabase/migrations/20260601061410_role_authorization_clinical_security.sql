create extension if not exists pgcrypto;

-- Seguridad de roles y datos clinicos.
-- Esta migracion es aditiva donde puede serlo, pero endurece RLS/privilegios
-- para que la separacion por rol no dependa de la UI.

alter table business_users
	add column if not exists status text not null default 'active' check (status in ('active','disabled')),
	add column if not exists accepted_at timestamptz,
	add column if not exists last_seen_at timestamptz,
	add column if not exists disabled_at timestamptz,
	add column if not exists disabled_reason text,
	add column if not exists created_by uuid references auth.users(id),
	add column if not exists updated_by uuid references auth.users(id),
	add column if not exists updated_at timestamptz not null default now();

update business_users
set
	status = coalesce(status, 'active'),
	accepted_at = coalesce(accepted_at, created_at),
	updated_at = coalesce(updated_at, created_at, now())
where accepted_at is null
	or updated_at is null;

create index if not exists business_users_business_status_role_idx
	on business_users (business_id, status, role);

create index if not exists business_users_user_status_idx
	on business_users (user_id, status);

create table if not exists business_user_invites (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	email text not null,
	role text not null check (role in ('owner','admin','reception','professional','readonly')),
	status text not null default 'pending' check (status in ('pending','accepted','cancelled','expired')),
	invited_by uuid references auth.users(id),
	accepted_user_id uuid references auth.users(id),
	accepted_at timestamptz,
	cancelled_by uuid references auth.users(id),
	cancelled_at timestamptz,
	expires_at timestamptz not null default (now() + interval '14 days'),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists business_user_invites_business_status_idx
	on business_user_invites (business_id, status, created_at desc);

create unique index if not exists business_user_invites_pending_email_uq
	on business_user_invites (lower(email))
	where status = 'pending';

do $$
begin
	if to_regclass('public.patients') is not null and not exists (
		select 1
		from pg_constraint c
		join pg_class t on t.oid = c.conrelid
		join pg_namespace n on n.oid = t.relnamespace
		cross join lateral (
			select array_agg(a.attname::text order by cols.ordinality) as column_names
			from unnest(c.conkey) with ordinality as cols(attnum, ordinality)
			join pg_attribute a on a.attrelid = t.oid and a.attnum = cols.attnum
		) cols
		where n.nspname = 'public'
			and t.relname = 'patients'
			and c.contype in ('p','u')
			and cols.column_names = array['business_id','id']
	) then
		alter table patients add constraint patients_business_id_id_uq unique (business_id, id);
	end if;

	if to_regclass('public.professionals') is not null and not exists (
		select 1
		from pg_constraint c
		join pg_class t on t.oid = c.conrelid
		join pg_namespace n on n.oid = t.relnamespace
		cross join lateral (
			select array_agg(a.attname::text order by cols.ordinality) as column_names
			from unnest(c.conkey) with ordinality as cols(attnum, ordinality)
			join pg_attribute a on a.attrelid = t.oid and a.attnum = cols.attnum
		) cols
		where n.nspname = 'public'
			and t.relname = 'professionals'
			and c.contype in ('p','u')
			and cols.column_names = array['business_id','id']
	) then
		alter table professionals add constraint professionals_business_id_id_uq unique (business_id, id);
	end if;

	if to_regclass('public.appointments') is not null and not exists (
		select 1
		from pg_constraint c
		join pg_class t on t.oid = c.conrelid
		join pg_namespace n on n.oid = t.relnamespace
		cross join lateral (
			select array_agg(a.attname::text order by cols.ordinality) as column_names
			from unnest(c.conkey) with ordinality as cols(attnum, ordinality)
			join pg_attribute a on a.attrelid = t.oid and a.attnum = cols.attnum
		) cols
		where n.nspname = 'public'
			and t.relname = 'appointments'
			and c.contype in ('p','u')
			and cols.column_names = array['business_id','id']
	) then
		alter table appointments add constraint appointments_business_id_id_uq unique (business_id, id);
	end if;
end $$;

alter table patients
	add column if not exists has_clinical_alert boolean not null default false;

create table if not exists patient_clinical_profiles (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	patient_id uuid not null references patients(id) on delete cascade,
	allergies text,
	medication text,
	background text,
	clinical_alert_note text,
	notes text,
	custom_fields jsonb,
	created_by uuid references auth.users(id),
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, patient_id)
);

create index if not exists patient_clinical_profiles_patient_idx
	on patient_clinical_profiles (business_id, patient_id);

insert into patient_clinical_profiles (
	business_id,
	patient_id,
	allergies,
	medication,
	background,
	clinical_alert_note,
	notes,
	custom_fields,
	created_at,
	updated_at
)
select
	p.business_id,
	p.id,
	nullif(p.allergies, ''),
	nullif(p.medication, ''),
	nullif(p.background, ''),
	null,
	nullif(p.notes, ''),
	p.custom_fields,
	coalesce(p.created_at, now()),
	coalesce(p.updated_at, now())
from patients p
where p.business_id is not null
	and (
		nullif(p.allergies, '') is not null
		or nullif(p.medication, '') is not null
		or nullif(p.background, '') is not null
		or nullif(p.notes, '') is not null
		or p.custom_fields is not null
	)
on conflict (business_id, patient_id) do update
set
	allergies = coalesce(patient_clinical_profiles.allergies, excluded.allergies),
	medication = coalesce(patient_clinical_profiles.medication, excluded.medication),
	background = coalesce(patient_clinical_profiles.background, excluded.background),
	clinical_alert_note = coalesce(patient_clinical_profiles.clinical_alert_note, excluded.clinical_alert_note),
	notes = coalesce(patient_clinical_profiles.notes, excluded.notes),
	custom_fields = coalesce(patient_clinical_profiles.custom_fields, excluded.custom_fields),
	updated_at = now();

update patients p
set has_clinical_alert = true
where p.business_id is not null
	and exists (
		select 1
		from patient_clinical_profiles pcp
		where pcp.business_id = p.business_id
			and pcp.patient_id = p.id
			and (
				nullif(pcp.allergies, '') is not null
				or nullif(pcp.medication, '') is not null
				or nullif(pcp.background, '') is not null
				or nullif(pcp.clinical_alert_note, '') is not null
			)
	);

alter table clinical_entries
	add column if not exists created_by_professional_id uuid,
	add column if not exists created_by_user_id uuid references auth.users(id),
	add column if not exists updated_by_user_id uuid references auth.users(id),
	add column if not exists locked_after timestamptz;

update clinical_entries ce
set
	created_by_user_id = case
		when ce.created_by_user_id is not null
			and exists (select 1 from auth.users u where u.id = ce.created_by_user_id)
			then ce.created_by_user_id
		when ce.owner_id is not null
			and exists (select 1 from auth.users u where u.id = ce.owner_id)
			then ce.owner_id
		else null
	end,
	updated_by_user_id = case
		when ce.updated_by_user_id is not null
			and exists (select 1 from auth.users u where u.id = ce.updated_by_user_id)
			then ce.updated_by_user_id
		else null
	end,
	locked_after = coalesce(ce.locked_after, coalesce(ce.created_at, now()) + interval '24 hours')
where ce.created_by_user_id is null
	or (
		ce.created_by_user_id is not null
		and not exists (select 1 from auth.users u where u.id = ce.created_by_user_id)
	)
	or (
		ce.updated_by_user_id is not null
		and not exists (select 1 from auth.users u where u.id = ce.updated_by_user_id)
	)
	or ce.locked_after is null;

do $$
begin
	if to_regclass('public.professionals') is not null and not exists (
		select 1
		from pg_constraint
		where conname = 'clinical_entries_business_professional_fk'
	) then
			alter table clinical_entries
				add constraint clinical_entries_business_professional_fk
				foreign key (business_id, created_by_professional_id)
				references professionals (business_id, id)
				on delete restrict;
		end if;
	end $$;

create table if not exists clinical_entry_costs (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	clinical_entry_id uuid not null references clinical_entries(id) on delete cascade,
	amount numeric,
	created_by uuid references auth.users(id),
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, clinical_entry_id)
);

create index if not exists clinical_entry_costs_business_entry_idx
	on clinical_entry_costs (business_id, clinical_entry_id);

insert into clinical_entry_costs (business_id, clinical_entry_id, amount, created_by, updated_by, created_at, updated_at)
select
	ce.business_id,
	ce.id,
	ce.amount,
	legacy_owner.id,
	legacy_owner.id,
	coalesce(ce.created_at, now()),
	coalesce(ce.updated_at, now())
from clinical_entries ce
left join auth.users legacy_owner on legacy_owner.id = ce.owner_id
where ce.business_id is not null
	and ce.amount is not null
on conflict (business_id, clinical_entry_id) do update
set
	amount = coalesce(clinical_entry_costs.amount, excluded.amount),
	updated_at = now();

create table if not exists professional_patient_links (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	professional_id uuid not null,
	patient_id uuid not null,
	source text not null check (source in ('appointment','public_booking','clinical_entry','manual','import')),
	source_entity_id uuid,
	is_active boolean not null default true,
	created_by uuid references auth.users(id),
	disabled_by uuid references auth.users(id),
	disabled_at timestamptz,
	disabled_reason text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	foreign key (business_id, professional_id)
		references professionals (business_id, id)
		on delete cascade,
	foreign key (business_id, patient_id)
		references patients (business_id, id)
		on delete cascade
);

create unique index if not exists professional_patient_links_active_uq
	on professional_patient_links (business_id, professional_id, patient_id)
	where is_active = true;

create index if not exists professional_patient_links_patient_idx
	on professional_patient_links (business_id, patient_id, is_active);

create index if not exists professional_patient_links_professional_idx
	on professional_patient_links (business_id, professional_id, is_active);

alter table public_booking_attempts
	add column if not exists appointment_id uuid,
	add column if not exists idempotency_key text;

do $$
begin
	if to_regclass('public.appointments') is not null and not exists (
		select 1
		from pg_constraint
		where conname = 'public_booking_attempts_appointment_fk'
	) then
		alter table public_booking_attempts
			add constraint public_booking_attempts_appointment_fk
			foreign key (business_id, appointment_id)
			references appointments (business_id, id)
			on delete set null;
	end if;
end $$;

create unique index if not exists public_booking_attempts_success_idempotency_uq
	on public_booking_attempts (business_id, idempotency_key)
	where action = 'booking_create'
		and success = true
		and idempotency_key is not null;

insert into professional_patient_links (
	business_id,
	professional_id,
	patient_id,
	source,
	source_entity_id,
	is_active,
	created_by,
	created_at,
	updated_at
)
select distinct on (a.business_id, a.professional_id, a.patient_id)
	a.business_id,
	a.professional_id,
	a.patient_id,
	case when a.source = 'public_booking' then 'public_booking' else 'appointment' end,
	a.id,
	true,
	appointment_actor.id,
	coalesce(a.created_at, now()),
	coalesce(a.updated_at, now())
from appointments a
left join auth.users appointment_actor on appointment_actor.id = a.created_by_user_id
where a.business_id is not null
	and a.professional_id is not null
	and a.patient_id is not null
order by a.business_id, a.professional_id, a.patient_id, a.created_at asc
on conflict do nothing;

alter table audit_logs
	add column if not exists reason_code text,
	add column if not exists result text not null default 'success' check (result in ('success','blocked','error'));

create index if not exists audit_logs_reason_created_idx
	on audit_logs (business_id, reason_code, created_at desc)
	where reason_code is not null;

create or replace function public.audit_security_event(
	p_business_id uuid,
	p_user_id uuid,
	p_action text,
	p_entity_type text,
	p_entity_id uuid,
	p_result text,
	p_reason_code text,
	p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into audit_logs (
		business_id,
		user_id,
		action,
		entity_type,
		entity_id,
		result,
		reason_code,
		metadata
	)
	values (
		p_business_id,
		p_user_id,
		p_action,
		p_entity_type,
		p_entity_id,
		case when p_result in ('success','blocked','error') then p_result else 'error' end,
		nullif(trim(coalesce(p_reason_code, '')), ''),
		coalesce(p_metadata, '{}'::jsonb)
	);
end;
$$;

create or replace function public.business_commercial_status(target_business_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
	select case
		when exists (
			select 1 from business_subscriptions bs where bs.business_id = target_business_id
		) then coalesce((
			select public.compute_business_subscription_status(
				bs.commercial_access_enabled,
				bs.is_permanent,
				bs.paid_until,
				bs.grace_until,
				bs.restricted_until,
				bs.archived_at
			)
			from business_subscriptions bs
			where bs.business_id = target_business_id
		), 'restricted')
		else case
			when exists (
				select 1
				from businesses b
				where b.id = target_business_id
					and b.created_at < timestamp with time zone '2026-05-28 05:21:36+00'
			) then 'active'
			else 'restricted'
		end
	end;
$$;

create or replace function public.business_allows_operation(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.business_commercial_status(target_business_id) in ('active','grace');
$$;

create or replace function public.business_allows_owner_restricted_read(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.business_commercial_status(target_business_id) in ('active','grace','restricted');
$$;

create or replace function public.user_business_role(target_business_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
	select bu.role
	from business_users bu
	where bu.business_id = target_business_id
		and bu.user_id = auth.uid()
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null
	order by
		case bu.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end
	limit 1;
$$;

create or replace function public.user_has_business_access(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select exists (
		select 1
		from business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = auth.uid()
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
	);
$$;

create or replace function public.user_can_manage_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin');
$$;

create or replace function public.user_can_operate_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin','reception')
		and public.business_allows_operation(target_business_id);
$$;

create or replace function public.user_can_configure_business(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.user_business_role(target_business_id) in ('owner','admin')
		and public.business_allows_operation(target_business_id);
$$;

create or replace function public.user_is_active_owner(target_business_id uuid, target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public, auth
as $$
	select exists (
		select 1
		from business_users bu
		join auth.users au on au.id = bu.user_id
		join allowed_emails ae on lower(ae.email) = lower(au.email)
		where bu.business_id = target_business_id
			and bu.user_id = target_user_id
			and bu.role = 'owner'
			and coalesce(bu.status, 'active') = 'active'
			and bu.accepted_at is not null
			and ae.enabled = true
	);
$$;

create or replace function public.count_active_business_owners(target_business_id uuid)
returns integer
language sql
security definer
set search_path = public, auth
as $$
	select count(*)::integer
	from business_users bu
	join auth.users au on au.id = bu.user_id
	join allowed_emails ae on lower(ae.email) = lower(au.email)
	where bu.business_id = target_business_id
		and bu.role = 'owner'
		and coalesce(bu.status, 'active') = 'active'
		and bu.accepted_at is not null
		and ae.enabled = true;
$$;

create or replace function public.current_user_professional_id(target_business_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
	select pu.professional_id
	from professional_users pu
	where pu.business_id = target_business_id
		and pu.user_id = auth.uid()
	order by pu.created_at asc
	limit 1;
$$;

create or replace function public.user_has_active_professional_patient_link(
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
		from professional_patient_links ppl
		join professional_users pu
			on pu.business_id = ppl.business_id
			and pu.professional_id = ppl.professional_id
		where ppl.business_id = target_business_id
			and ppl.patient_id = target_patient_id
			and ppl.is_active = true
			and pu.user_id = auth.uid()
	);
$$;

create or replace function public.user_can_read_basic_patient(
	target_business_id uuid,
	target_patient_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select case
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
	select public.business_allows_operation(target_business_id)
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

create or replace function public.user_can_view_costs(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.business_allows_operation(target_business_id)
		and public.user_business_role(target_business_id) in ('owner','admin');
$$;

create or replace function public.user_can_read_professional_schedule(
	target_business_id uuid,
	target_professional_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select case
			when public.user_business_role(target_business_id) in ('owner','admin')
				then public.business_allows_operation(target_business_id)
		when public.user_business_role(target_business_id) = 'professional'
			then public.business_allows_operation(target_business_id)
				and exists (
					select 1
					from professional_users pu
					where pu.business_id = target_business_id
						and pu.professional_id = target_professional_id
						and pu.user_id = auth.uid()
				)
		else false
	end;
$$;

create or replace function public.user_can_read_appointment(
	target_business_id uuid,
	target_professional_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
	select case
		when public.user_business_role(target_business_id) in ('owner','admin','reception','readonly')
			then public.business_allows_operation(target_business_id)
		when public.user_business_role(target_business_id) = 'professional'
			then public.business_allows_operation(target_business_id)
				and exists (
					select 1
					from professional_users pu
					where pu.business_id = target_business_id
						and pu.professional_id = target_professional_id
						and pu.user_id = auth.uid()
				)
		else false
	end;
$$;

create or replace function public.user_can_manage_users(target_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
	select public.business_allows_operation(target_business_id)
		and public.user_business_role(target_business_id) in ('owner','admin');
$$;

create or replace function public.upsert_patient_clinical_profile_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_allergies text default null,
	p_medication text default null,
	p_background text default null,
	p_clinical_alert_note text default null,
	p_notes text default null,
	p_custom_fields jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_profile_id uuid;
	v_has_alert boolean;
	v_patient_id uuid;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'patient.clinical_profile.upsert',
			'patient',
			p_patient_id,
			'blocked',
			'RECEPTION_CLINICAL_DENIED',
			'{}'::jsonb
		);
		raise exception 'CLINICAL_PROFILE_DENIED';
	end if;

	select p.id
	into v_patient_id
	from patients p
	where p.business_id = p_business_id
		and p.id = p_patient_id
	for update;

	if v_patient_id is null then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	v_has_alert :=
		nullif(p_allergies, '') is not null
		or nullif(p_medication, '') is not null
		or nullif(p_background, '') is not null
		or nullif(p_clinical_alert_note, '') is not null;

	insert into patient_clinical_profiles (
		business_id,
		patient_id,
		allergies,
		medication,
		background,
		clinical_alert_note,
		notes,
		custom_fields,
		created_by,
		updated_by
	)
	values (
		p_business_id,
		p_patient_id,
		nullif(p_allergies, ''),
		nullif(p_medication, ''),
		nullif(p_background, ''),
		nullif(p_clinical_alert_note, ''),
		nullif(p_notes, ''),
		p_custom_fields,
		auth.uid(),
		auth.uid()
	)
	on conflict (business_id, patient_id) do update
	set
		allergies = excluded.allergies,
		medication = excluded.medication,
		background = excluded.background,
		clinical_alert_note = excluded.clinical_alert_note,
		notes = excluded.notes,
		custom_fields = excluded.custom_fields,
		updated_by = auth.uid(),
		updated_at = now()
	returning id into v_profile_id;

	update patients
	set
		has_clinical_alert = v_has_alert,
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	perform public.audit_security_event(
		p_business_id,
		auth.uid(),
		'patient.clinical_profile.upserted',
		'patient',
		p_patient_id,
		'success',
		null,
		'{}'::jsonb
	);

	return v_profile_id;
end;
$$;

create or replace function public.set_patient_archive_state_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_archived boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'patient.archive',
			'patient',
			p_patient_id,
			'blocked',
			'PATIENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'PATIENT_ARCHIVE_DENIED';
	end if;

	update patients
	set
		archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	perform public.audit_security_event(
		p_business_id,
		auth.uid(),
		case when p_archived then 'patient.archived' else 'patient.unarchived' end,
		'patient',
		p_patient_id,
		'success',
		null,
		'{}'::jsonb
	);
end;
$$;

create or replace function public.set_patient_drive_folder_safely(
	p_business_id uuid,
	p_patient_id uuid,
	p_drive_folder_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'patient.drive_folder.set',
			'patient',
			p_patient_id,
			'blocked',
			'PATIENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	update patients
	set
		drive_folder_id = nullif(trim(coalesce(p_drive_folder_id, '')), ''),
		updated_at = now()
	where business_id = p_business_id
		and id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;
end;
$$;

create or replace function public.get_patient_drive_folder_safely(
	p_business_id uuid,
	p_patient_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
	v_drive_folder_id text;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'patient.drive_folder.read',
			'patient',
			p_patient_id,
			'blocked',
			'PATIENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	select p.drive_folder_id
	into v_drive_folder_id
	from patients p
	where p.business_id = p_business_id
		and p.id = p_patient_id;

	if not found then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	return v_drive_folder_id;
end;
$$;

create or replace function public.clear_patient_drive_folders_safely(
	p_business_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(p_business_id) not in ('owner','admin')
		or not public.business_allows_operation(p_business_id)
	then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'patient.drive_folder.clear_all',
			'patient',
			null,
			'blocked',
			'PATIENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'PATIENT_DRIVE_FOLDER_DENIED';
	end if;

	update patients
	set
		drive_folder_id = null,
		updated_at = now()
	where business_id = p_business_id;
end;
$$;

create or replace function public.ensure_user_default_business(
	p_name text default null,
	p_industry text default 'odontology'
)
returns table(business_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
	perform p_name, p_industry;
	business_id := null;
	role := null;
	raise exception 'DEFAULT_BUSINESS_CREATION_DISABLED';
end;
$$;

create or replace function public.replace_professional_availability_rules(
	p_business_id uuid,
	p_professional_id uuid,
	p_weekdays int[],
	p_ranges jsonb,
	p_slot_interval_minutes int
)
returns setof public.availability_rules
language plpgsql
security invoker
set search_path = public
as $$
begin
	if auth.uid() is not null and not public.user_can_configure_business(p_business_id) then
		perform public.audit_security_event(
			p_business_id,
			auth.uid(),
			'availability_rules.replace',
			'professional',
			p_professional_id,
			'blocked',
			'SERVICE_ROLE_ACTION_DENIED',
			'{}'::jsonb
		);
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	if p_business_id is null or p_professional_id is null then
		raise exception 'INVALID_PROFESSIONAL';
	end if;

	if p_weekdays is null or array_length(p_weekdays, 1) is null then
		raise exception 'NO_WEEKDAYS';
	end if;

	if exists (
		select 1
		from unnest(p_weekdays) as weekday
		where weekday < 0 or weekday > 6
	) then
		raise exception 'INVALID_WEEKDAY';
	end if;

	if p_slot_interval_minutes is null or p_slot_interval_minutes < 5 or p_slot_interval_minutes > 120 then
		raise exception 'INVALID_SLOT_INTERVAL';
	end if;

	if coalesce(jsonb_typeof(p_ranges), '') <> 'array' or jsonb_array_length(p_ranges) = 0 then
		raise exception 'NO_RANGES';
	end if;

	if exists (
		select 1
		from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		where range_row.start_time is null
			or range_row.end_time is null
			or range_row.start_time >= range_row.end_time
	) then
		raise exception 'INVALID_RANGE';
	end if;

	if exists (
		with parsed_ranges as (
			select
				range_row.start_time,
				range_row.end_time,
				lag(range_row.end_time) over (order by range_row.start_time, range_row.end_time) as previous_end
			from jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
		)
		select 1
		from parsed_ranges
		where previous_end is not null
			and start_time < previous_end
	) then
		raise exception 'OVERLAPPING_RANGES';
	end if;

	delete from public.availability_rules
	where business_id = p_business_id
		and professional_id = p_professional_id
		and weekday in (select distinct weekday from unnest(p_weekdays) as weekdays(weekday));

	return query
	insert into public.availability_rules (
		business_id,
		professional_id,
		weekday,
		start_time,
		end_time,
		slot_interval_minutes,
		is_active
	)
	select
		p_business_id,
		p_professional_id,
		weekdays.weekday,
		range_row.start_time,
		range_row.end_time,
		p_slot_interval_minutes,
		true
	from (select distinct weekday from unnest(p_weekdays) as weekdays(weekday)) as weekdays
	cross join jsonb_to_recordset(p_ranges) as range_row(start_time time, end_time time)
	returning *;
end;
$$;

create or replace function public.create_or_restore_professional_patient_link(
	p_business_id uuid,
	p_professional_id uuid,
	p_patient_id uuid,
	p_source text,
	p_source_entity_id uuid default null,
	p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_link_id uuid;
	v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
begin
	if v_source not in ('appointment','public_booking','clinical_entry','manual','import') then
		raise exception 'INVALID_LINK_SOURCE';
	end if;

	if p_business_id is null or p_professional_id is null or p_patient_id is null then
		raise exception 'INVALID_PROFESSIONAL_PATIENT_LINK';
	end if;

	if not exists (
		select 1 from professionals p
		where p.business_id = p_business_id and p.id = p_professional_id
	) then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;

	if not exists (
		select 1 from patients p
		where p.business_id = p_business_id and p.id = p_patient_id
	) then
		raise exception 'PATIENT_NOT_FOUND';
	end if;

	select id
	into v_link_id
	from professional_patient_links
	where business_id = p_business_id
		and professional_id = p_professional_id
		and patient_id = p_patient_id
		and is_active = true
	limit 1;

	if v_link_id is not null then
		update professional_patient_links
		set
			source = v_source,
			source_entity_id = coalesce(p_source_entity_id, source_entity_id),
			updated_at = now()
		where id = v_link_id;
		return v_link_id;
	end if;

	update professional_patient_links
	set
		is_active = true,
		disabled_by = null,
		disabled_at = null,
		disabled_reason = null,
		source = v_source,
		source_entity_id = p_source_entity_id,
		created_by = coalesce(p_created_by, auth.uid(), created_by),
		updated_at = now()
	where business_id = p_business_id
		and professional_id = p_professional_id
		and patient_id = p_patient_id
		and is_active = false
	returning id into v_link_id;

	if v_link_id is not null then
		return v_link_id;
	end if;

	insert into professional_patient_links (
		business_id,
		professional_id,
		patient_id,
		source,
		source_entity_id,
		created_by
	)
	values (
		p_business_id,
		p_professional_id,
		p_patient_id,
		v_source,
		p_source_entity_id,
		coalesce(p_created_by, auth.uid())
	)
	returning id into v_link_id;

	return v_link_id;
end;
$$;

create or replace function public.link_patient_to_professional_safely(
	p_business_id uuid,
	p_professional_id uuid,
	p_patient_id uuid,
	p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor uuid := auth.uid();
	v_role text;
begin
	if v_actor is null then
		raise exception 'SESSION_REQUIRED';
	end if;

	v_role := public.user_business_role(p_business_id);
	if v_role not in ('owner','admin') or not public.business_allows_operation(p_business_id) then
		perform public.audit_security_event(
			p_business_id,
			v_actor,
			'professional_patient_link.create.denied',
			'professional_patient_link',
			null,
			'blocked',
			'PROFESSIONAL_LINK_MANUAL_DENIED',
			jsonb_build_object(
				'professional_id', p_professional_id,
				'patient_id', p_patient_id,
				'has_reason', nullif(trim(coalesce(p_reason, '')), '') is not null
			)
		);
		raise exception 'ACCESS_DENIED';
	end if;

	return public.create_or_restore_professional_patient_link(
		p_business_id,
		p_professional_id,
		p_patient_id,
		'manual',
		null,
		v_actor
	);
end;
$$;

create or replace function public.link_patient_to_professional_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if tg_op = 'INSERT'
		or new.professional_id is distinct from old.professional_id
		or new.patient_id is distinct from old.patient_id
	then
		perform public.create_or_restore_professional_patient_link(
			new.business_id,
			new.professional_id,
			new.patient_id,
			case when new.source = 'public_booking' then 'public_booking' else 'appointment' end,
			new.id,
			new.created_by_user_id
		);
	end if;
	return new;
end;
$$;

drop trigger if exists trg_appointments_professional_patient_link on appointments;
create trigger trg_appointments_professional_patient_link
	after insert or update of professional_id, patient_id
	on appointments
	for each row
	execute function public.link_patient_to_professional_from_appointment();

create or replace function public.set_clinical_entry_actor_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_role text;
	v_professional_id uuid;
begin
	if tg_op = 'INSERT' then
		if auth.uid() is not null then
			v_role := public.user_business_role(new.business_id);
			new.owner_id := auth.uid();
			new.created_by_user_id := auth.uid();

			if v_role = 'professional' then
				v_professional_id := public.current_user_professional_id(new.business_id);
				if v_professional_id is null then
					raise exception 'PROFESSIONAL_LINK_REQUIRED';
				end if;
				new.created_at := now();
				new.created_by_professional_id := v_professional_id;
			else
				if v_role in ('owner','admin') and new.created_at > now() + interval '5 minutes' then
					raise exception 'INVALID_CLINICAL_ENTRY_DATE';
				end if;
				new.created_by_professional_id := null;
			end if;
		end if;

		new.created_at := coalesce(new.created_at, now());
		new.locked_after := coalesce(new.locked_after, new.created_at + interval '24 hours');
	end if;

	if tg_op = 'UPDATE' and auth.uid() is not null then
		new.updated_by_user_id := auth.uid();
	end if;

	return new;
end;
$$;

drop trigger if exists trg_clinical_entries_actor_fields on clinical_entries;
create trigger trg_clinical_entries_actor_fields
	before insert or update
	on clinical_entries
	for each row
	execute function public.set_clinical_entry_actor_fields();

create or replace function public.enforce_appointment_role_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_role text;
begin
	if auth.uid() is null then
		return new;
	end if;

	v_role := public.user_business_role(new.business_id);

	if v_role in ('owner','admin') and public.business_allows_operation(new.business_id) then
		return new;
	end if;

	if v_role = 'reception' and public.business_allows_operation(new.business_id) then
		if new.status in ('attended','no_show') and new.status is distinct from old.status then
			perform public.audit_security_event(
				new.business_id,
				auth.uid(),
				'appointment.status_update',
				'appointment',
				new.id,
				'blocked',
				'CAPABILITY_DENIED',
				jsonb_build_object('target_status', new.status)
			);
			raise exception 'APPOINTMENT_ATTENDANCE_DENIED';
		end if;
		return new;
	end if;

	if v_role = 'professional'
		and public.business_allows_operation(new.business_id)
		and new.status in ('attended','no_show')
		and exists (
			select 1
			from professional_users pu
			where pu.business_id = new.business_id
				and pu.professional_id = new.professional_id
				and pu.user_id = auth.uid()
		)
	then
		return new;
	end if;

	perform public.audit_security_event(
		new.business_id,
		auth.uid(),
		'appointment.update',
		'appointment',
		new.id,
		'blocked',
		'SERVICE_ROLE_ACTION_DENIED',
		'{}'::jsonb
	);
	raise exception 'APPOINTMENT_ACCESS_DENIED';
end;
$$;

drop trigger if exists trg_appointments_role_update on appointments;
create trigger trg_appointments_role_update
	before update
	on appointments
	for each row
	execute function public.enforce_appointment_role_update();

create or replace function public.professional_update_appointment_status(
	target_business_id uuid,
	target_appointment_id uuid,
	target_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_appointment record;
	v_now timestamptz := now();
	v_professional_id uuid;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	if public.user_business_role(target_business_id) <> 'professional' then
		perform public.audit_security_event(
			target_business_id,
			auth.uid(),
			'appointment.professional_status_update',
			'appointment',
			target_appointment_id,
			'blocked',
			'APPOINTMENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'APPOINTMENT_ACCESS_DENIED';
	end if;

	if not public.business_allows_operation(target_business_id) then
		perform public.audit_security_event(
			target_business_id,
			auth.uid(),
			'appointment.professional_status_update',
			'appointment',
			target_appointment_id,
			'blocked',
			'COMMERCIAL_RESTRICTED',
			'{}'::jsonb
		);
		raise exception 'BUSINESS_ACCESS_RESTRICTED';
	end if;

	if target_status not in ('attended','no_show') then
		raise exception 'INVALID_PROFESSIONAL_STATUS';
	end if;

	v_professional_id := public.current_user_professional_id(target_business_id);
	if v_professional_id is null then
		perform public.audit_security_event(
			target_business_id,
			auth.uid(),
			'appointment.professional_status_update',
			'appointment',
			target_appointment_id,
			'blocked',
			'PROFESSIONAL_LINK_REQUIRED',
			'{}'::jsonb
		);
		raise exception 'PROFESSIONAL_LINK_REQUIRED';
	end if;

	select id, professional_id, starts_at, ends_at, status
	into v_appointment
	from appointments
	where business_id = target_business_id
		and id = target_appointment_id
	for update;

	if not found then
		raise exception 'APPOINTMENT_NOT_FOUND';
	end if;

	if v_appointment.professional_id <> v_professional_id then
		perform public.audit_security_event(
			target_business_id,
			auth.uid(),
			'appointment.professional_status_update',
			'appointment',
			target_appointment_id,
			'blocked',
			'APPOINTMENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'APPOINTMENT_ACCESS_DENIED';
	end if;

	if v_appointment.status in ('cancelled','attended','no_show') then
		raise exception 'APPOINTMENT_TERMINAL_STATUS';
	end if;

	if target_status = 'attended' and v_appointment.starts_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_ATTEND_IN_FUTURE';
	end if;

	if target_status = 'no_show' and v_appointment.ends_at > v_now then
		raise exception 'APPOINTMENT_CANNOT_NO_SHOW_BEFORE_END';
	end if;

	update appointments
	set
		status = target_status,
		attended_at = case when target_status = 'attended' then v_now else attended_at end,
		no_show_at = case when target_status = 'no_show' then v_now else no_show_at end,
		updated_by_user_id = auth.uid(),
		updated_at = v_now
	where business_id = target_business_id
		and id = target_appointment_id;

	perform public.audit_security_event(
		target_business_id,
		auth.uid(),
		case when target_status = 'attended' then 'appointment.attended' else 'appointment.no_show' end,
		'appointment',
		target_appointment_id,
		'success',
		null,
		jsonb_build_object('via', 'professional_panel', 'from_status', v_appointment.status)
	);
end;
$$;

create or replace function public.link_patient_to_professional_from_clinical_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.created_by_professional_id is not null then
		perform public.create_or_restore_professional_patient_link(
			new.business_id,
			new.created_by_professional_id,
			new.patient_id,
			'clinical_entry',
			new.id,
			new.created_by_user_id
		);
	end if;
	return new;
end;
$$;

drop trigger if exists trg_clinical_entries_professional_patient_link on clinical_entries;
create trigger trg_clinical_entries_professional_patient_link
	after insert
	on clinical_entries
	for each row
	execute function public.link_patient_to_professional_from_clinical_entry();

create or replace function public.disable_professional_patient_link(
	p_link_id uuid,
	p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_link professional_patient_links%rowtype;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_link
	from professional_patient_links
	where id = p_link_id
	for update;

	if not found then
		raise exception 'PROFESSIONAL_PATIENT_LINK_NOT_FOUND';
	end if;

	if not public.user_can_configure_business(v_link.business_id) then
		perform public.audit_security_event(
			v_link.business_id,
			auth.uid(),
			'professional_patient_link.disable',
			'professional_patient_link',
			p_link_id,
			'blocked',
			'PATIENT_ACCESS_DENIED',
			'{}'::jsonb
		);
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	update professional_patient_links
	set
		is_active = false,
		disabled_by = auth.uid(),
		disabled_at = now(),
		disabled_reason = nullif(trim(coalesce(p_reason, '')), ''),
		updated_at = now()
	where id = p_link_id;
end;
$$;

create or replace function public.add_business_user_by_email(
	target_business_id uuid,
	target_email text,
	target_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor_role text;
	v_target_user_id uuid;
	v_target_email text := lower(trim(target_email));
	v_membership business_users%rowtype;
	v_membership_id uuid;
	v_reassigned_from_history boolean := false;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	perform pg_advisory_xact_lock(hashtext(target_business_id::text));

	v_actor_role := public.user_business_role(target_business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(target_business_id) then
		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'SERVICE_ROLE_ACTION_DENIED', '{}'::jsonb);
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	if target_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;

	if v_actor_role = 'admin' and target_role in ('owner','admin') then
		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'ADMIN_OWNER_ACTION_DENIED', jsonb_build_object('target_role', target_role));
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;

	if v_target_email = '' or position('@' in v_target_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_target_email
	limit 1;

	if v_target_user_id is null then
		raise exception 'USER_NOT_FOUND';
	end if;

		if exists (
			select 1
			from business_users bu
			where bu.user_id = v_target_user_id
				and coalesce(bu.status, 'active') = 'active'
				and bu.business_id <> target_business_id
	) or exists (
		select 1
		from business_user_invites bi
		where lower(bi.email) = v_target_email
			and bi.status = 'pending'
			and bi.business_id <> target_business_id
	) then
			perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'EMAIL_ALREADY_ASSIGNED', '{}'::jsonb);
			raise exception 'EMAIL_ALREADY_ASSIGNED';
		end if;

		v_reassigned_from_history := exists (
			select 1
			from business_users bu
			where bu.user_id = v_target_user_id
				and coalesce(bu.status, 'active') = 'disabled'
				and bu.business_id <> target_business_id
		) or exists (
			select 1
			from allowed_emails ae
			where lower(ae.email) = v_target_email
				and ae.enabled = false
		);

	insert into allowed_emails (email, enabled, created_by, updated_by)
	values (v_target_email, true, auth.uid(), auth.uid())
	on conflict (email) do update
	set
		enabled = true,
		disabled_at = null,
		disabled_reason = null,
		updated_by = auth.uid(),
		updated_at = now();

	select *
	into v_membership
	from business_users bu
	where bu.business_id = target_business_id
		and bu.user_id = v_target_user_id
	for update;

	if found then
		if v_membership.role in ('owner','admin') and v_actor_role = 'admin' then
			perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.role_change', 'business_user', v_membership.id, 'blocked', 'ADMIN_OWNER_ACTION_DENIED', jsonb_build_object('from_role', v_membership.role, 'to_role', target_role));
			raise exception 'ADMIN_OWNER_ACTION_DENIED';
		end if;
		if v_membership.role = 'owner' and target_role <> 'owner' and public.count_active_business_owners(target_business_id) <= 1 then
			perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.role_change', 'business_user', v_membership.id, 'blocked', 'LAST_OWNER_BLOCKED', '{}'::jsonb);
			raise exception 'LAST_OWNER_BLOCKED';
		end if;

		update business_users
		set
			role = target_role,
			status = 'active',
			accepted_at = coalesce(accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = auth.uid(),
			updated_at = now()
		where id = v_membership.id
		returning id into v_membership_id;
	else
		insert into business_users (
			business_id,
			user_id,
			role,
			status,
			accepted_at,
			created_by,
			updated_by
		)
		values (
			target_business_id,
			v_target_user_id,
			target_role,
			'active',
			now(),
			auth.uid(),
			auth.uid()
		)
		returning id into v_membership_id;
	end if;

		perform public.audit_security_event(
			target_business_id,
			auth.uid(),
			'business_user.added_or_updated',
			'business_user',
			v_membership_id,
			'success',
			case when v_reassigned_from_history then 'EMAIL_REASSIGNED_AFTER_DISABLED_HISTORY' else null end,
			jsonb_build_object('target_role', target_role)
		);
		return v_membership_id;
	end;
	$$;

create or replace function public.change_business_user_role_safely(
	p_membership_id uuid,
	p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_target business_users%rowtype;
	v_actor_role text;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_target
	from business_users
	where id = p_membership_id
	for update;

	if not found then
		raise exception 'BUSINESS_USER_NOT_FOUND';
	end if;

	perform pg_advisory_xact_lock(hashtext(v_target.business_id::text));

	v_actor_role := public.user_business_role(v_target.business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_change', 'business_user', p_membership_id, 'blocked', 'SERVICE_ROLE_ACTION_DENIED', '{}'::jsonb);
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if p_role not in ('owner','admin','reception','professional','readonly') then
		raise exception 'INVALID_ROLE';
	end if;
	if v_actor_role = 'admin' and (v_target.role in ('owner','admin') or p_role in ('owner','admin')) then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_change', 'business_user', p_membership_id, 'blocked', 'ADMIN_OWNER_ACTION_DENIED', jsonb_build_object('from_role', v_target.role, 'to_role', p_role));
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if v_target.role = 'owner' and p_role <> 'owner' and public.count_active_business_owners(v_target.business_id) <= 1 then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_change', 'business_user', p_membership_id, 'blocked', 'LAST_OWNER_BLOCKED', '{}'::jsonb);
		raise exception 'LAST_OWNER_BLOCKED';
	end if;

	update business_users
	set
		role = p_role,
		updated_by = auth.uid(),
		updated_at = now()
	where id = p_membership_id;

	perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_changed', 'business_user', p_membership_id, 'success', null, jsonb_build_object('from_role', v_target.role, 'to_role', p_role));
end;
$$;

create or replace function public.disable_business_user_safely(
	p_membership_id uuid,
	p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_target business_users%rowtype;
	v_actor_role text;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	select *
	into v_target
	from business_users
	where id = p_membership_id
	for update;

	if not found then
		raise exception 'BUSINESS_USER_NOT_FOUND';
	end if;

	perform pg_advisory_xact_lock(hashtext(v_target.business_id::text));

	v_actor_role := public.user_business_role(v_target.business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.disable', 'business_user', p_membership_id, 'blocked', 'SERVICE_ROLE_ACTION_DENIED', '{}'::jsonb);
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	if v_actor_role = 'admin' and v_target.role in ('owner','admin') then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.disable', 'business_user', p_membership_id, 'blocked', 'ADMIN_OWNER_ACTION_DENIED', jsonb_build_object('target_role', v_target.role));
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;
	if v_target.role = 'owner' and public.count_active_business_owners(v_target.business_id) <= 1 then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.disable', 'business_user', p_membership_id, 'blocked', 'LAST_OWNER_BLOCKED', '{}'::jsonb);
		raise exception 'LAST_OWNER_BLOCKED';
	end if;

	update business_users
	set
		status = 'disabled',
		disabled_at = now(),
		disabled_reason = nullif(trim(coalesce(p_reason, '')), ''),
		updated_by = auth.uid(),
		updated_at = now()
	where id = p_membership_id;

	perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.disabled', 'business_user', p_membership_id, 'success', null, jsonb_build_object('target_role', v_target.role));
end;
$$;

create or replace function public.disable_allowed_email_safely(
	p_email text,
	p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_email text := lower(trim(coalesce(p_email, '')));
	v_target_user_id uuid;
	v_target record;
	v_actor_role text;
	v_active_memberships integer := 0;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_email
	limit 1;

	if v_target_user_id is null then
		raise exception 'USER_NOT_FOUND';
	end if;

		for v_target in
			select bu.*
			from business_users bu
			where bu.user_id = v_target_user_id
				and coalesce(bu.status, 'active') = 'active'
			order by bu.business_id
		loop
			v_active_memberships := v_active_memberships + 1;
			perform pg_advisory_xact_lock(hashtext(v_target.business_id::text));

		v_actor_role := public.user_business_role(v_target.business_id);
		if v_actor_role not in ('owner','admin') or not public.business_allows_operation(v_target.business_id) then
			perform public.audit_security_event(
				v_target.business_id,
				auth.uid(),
				'allowed_email.disable',
				'allowed_email',
				null,
				'blocked',
				'SERVICE_ROLE_ACTION_DENIED',
				'{}'::jsonb
			);
			raise exception 'BUSINESS_MANAGE_DENIED';
		end if;

		if v_actor_role = 'admin' and v_target.role in ('owner','admin') then
			perform public.audit_security_event(
				v_target.business_id,
				auth.uid(),
				'allowed_email.disable',
				'allowed_email',
				null,
				'blocked',
				'ADMIN_OWNER_ACTION_DENIED',
				jsonb_build_object('target_role', v_target.role)
			);
			raise exception 'ADMIN_OWNER_ACTION_DENIED';
		end if;

		if v_target.role = 'owner' and public.count_active_business_owners(v_target.business_id) <= 1 then
			perform public.audit_security_event(
				v_target.business_id,
				auth.uid(),
				'allowed_email.disable',
				'allowed_email',
				null,
				'blocked',
				'LAST_OWNER_BLOCKED',
				'{}'::jsonb
			);
				raise exception 'LAST_OWNER_BLOCKED';
			end if;
		end loop;

		if v_active_memberships = 0 then
			perform public.audit_security_event(
				null,
				auth.uid(),
				'allowed_email.disable',
				'allowed_email',
				null,
				'blocked',
				'SERVICE_ROLE_ACTION_DENIED',
				'{}'::jsonb
			);
			raise exception 'BUSINESS_MANAGE_DENIED';
		end if;

	update allowed_emails
	set
		enabled = false,
		disabled_at = now(),
		disabled_reason = nullif(trim(coalesce(p_reason, '')), ''),
		updated_by = auth.uid(),
		updated_at = now()
	where lower(email) = v_email;

	if not found then
		raise exception 'ALLOWED_EMAIL_NOT_FOUND';
	end if;

	perform public.audit_security_event(
		null,
		auth.uid(),
		'allowed_email.disabled',
		'allowed_email',
		null,
		'success',
		null,
		'{}'::jsonb
	);
	end;
	$$;

create or replace function public.disable_allowed_email_as_master_safely(
	p_email text,
	p_actor_id uuid,
	p_actor_email text,
	p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_email text := lower(trim(coalesce(p_email, '')));
	v_actor_email text := lower(trim(coalesce(p_actor_email, '')));
	v_target_user_id uuid;
	v_target record;
begin
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;
	if v_actor_email = '' or v_actor_email = v_email then
		raise exception 'MASTER_EMAIL_PROTECTED';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_email
	limit 1;

	for v_target in
		select bu.*
		from business_users bu
		where bu.user_id = v_target_user_id
			and coalesce(bu.status, 'active') = 'active'
		order by bu.business_id
	loop
		perform pg_advisory_xact_lock(hashtext(v_target.business_id::text));
		if v_target.role = 'owner' and public.count_active_business_owners(v_target.business_id) <= 1 then
			perform public.audit_security_event(
				v_target.business_id,
				p_actor_id,
				'allowed_email.master_disable',
				'allowed_email',
				null,
				'blocked',
				'LAST_OWNER_BLOCKED',
				'{}'::jsonb
			);
			raise exception 'LAST_OWNER_BLOCKED';
		end if;
	end loop;

	update allowed_emails
	set
		enabled = false,
		disabled_at = now(),
		disabled_reason = nullif(trim(coalesce(p_reason, '')), ''),
		updated_by = p_actor_id,
		updated_at = now()
	where lower(email) = v_email;

	if not found then
		raise exception 'ALLOWED_EMAIL_NOT_FOUND';
	end if;

	perform public.audit_security_event(
		null,
		p_actor_id,
		'allowed_email.master_disabled',
		'allowed_email',
		null,
		'success',
		null,
		'{}'::jsonb
	);
end;
$$;

create or replace function public.link_professional_user_safely(
	p_business_id uuid,
	p_professional_id uuid,
	p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_actor_role text;
	v_link_id uuid;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;

	v_actor_role := public.user_business_role(p_business_id);
	if v_actor_role not in ('owner','admin') or not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	if not exists (
		select 1 from business_users bu
		where bu.business_id = p_business_id
			and bu.user_id = p_user_id
			and bu.role = 'professional'
			and coalesce(bu.status, 'active') = 'active'
	) then
		raise exception 'PROFESSIONAL_USER_ROLE_REQUIRED';
	end if;

	if exists (
		select 1
		from professional_users pu
		where pu.business_id = p_business_id
			and pu.user_id = p_user_id
			and pu.professional_id <> p_professional_id
	) then
		raise exception 'USER_ALREADY_LINKED_TO_PROFESSIONAL';
	end if;

	if exists (
		select 1
		from professional_users pu
		where pu.business_id = p_business_id
			and pu.professional_id = p_professional_id
			and pu.user_id <> p_user_id
	) then
		raise exception 'PROFESSIONAL_ALREADY_LINKED_TO_USER';
	end if;

	insert into professional_users (business_id, professional_id, user_id)
	values (p_business_id, p_professional_id, p_user_id)
	on conflict (business_id, professional_id, user_id) do update
	set created_at = professional_users.created_at
	returning id into v_link_id;

	perform public.audit_security_event(p_business_id, auth.uid(), 'professional_user.linked', 'professional', p_professional_id, 'success', null, jsonb_build_object('target_user_id', p_user_id));
	return v_link_id;
end;
$$;

create or replace function public.unlink_professional_user_safely(
	p_business_id uuid,
	p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_link professional_users%rowtype;
begin
	if auth.uid() is null then
		raise exception 'AUTH_REQUIRED';
	end if;
	if public.user_business_role(p_business_id) not in ('owner','admin') or not public.business_allows_operation(p_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;
	select * into v_link from professional_users where business_id = p_business_id and id = p_link_id;
	if not found then
		raise exception 'PROFESSIONAL_USER_LINK_NOT_FOUND';
	end if;
	delete from professional_users where business_id = p_business_id and id = p_link_id;
	perform public.audit_security_event(p_business_id, auth.uid(), 'professional_user.unlinked', 'professional', v_link.professional_id, 'success', null, jsonb_build_object('target_user_id', v_link.user_id));
end;
$$;

drop index if exists professional_users_user_business_unique_idx;
create unique index if not exists professional_users_business_user_uq
	on professional_users (business_id, user_id);

create unique index if not exists professional_users_business_professional_uq
	on professional_users (business_id, professional_id);

revoke all on table business_user_invites from anon, authenticated;
grant select on table business_user_invites to authenticated;

revoke all on table patient_clinical_profiles from anon, authenticated;
grant select, insert, update on table patient_clinical_profiles to authenticated;

revoke all on table clinical_entry_costs from anon, authenticated;
grant select, insert, update, delete on table clinical_entry_costs to authenticated;

revoke all on table patients from anon, authenticated;
grant select (
	id,
	business_id,
	owner_id,
	full_name,
	dni,
	phone,
	phone_raw,
	phone_e164,
	email,
	birth_date,
	address,
	insurance,
	insurance_plan,
	blocked,
	has_clinical_alert,
	archived_at,
	last_entry_at,
	created_at,
	updated_at
) on patients to authenticated;
grant insert (
	owner_id,
	business_id,
	full_name,
	dni,
	phone,
	phone_raw,
	phone_e164,
	email,
	birth_date,
	address,
	insurance,
	insurance_plan
) on patients to authenticated;
grant update (
	full_name,
	dni,
	phone,
	phone_raw,
	phone_e164,
	email,
	birth_date,
	address,
	insurance,
	insurance_plan,
	updated_at
) on patients to authenticated;

revoke all on table clinical_entries from anon, authenticated;
grant select (
	id,
	business_id,
	owner_id,
	patient_id,
	created_at,
	entry_type,
	description,
	teeth,
	internal_note,
	archived_at,
	updated_at,
	created_by_professional_id,
	created_by_user_id,
	updated_by_user_id,
	locked_after
) on clinical_entries to authenticated;
grant insert (
	owner_id,
	business_id,
	patient_id,
	created_at,
	entry_type,
	description,
	teeth,
	internal_note
) on clinical_entries to authenticated;
grant update (
	entry_type,
	description,
	teeth,
	internal_note,
	updated_at
) on clinical_entries to authenticated;

revoke execute on function public.audit_security_event(uuid, uuid, text, text, uuid, text, text, jsonb) from public, anon;
revoke execute on function public.business_commercial_status(uuid) from public, anon;
revoke execute on function public.business_allows_operation(uuid) from public, anon;
revoke execute on function public.business_allows_owner_restricted_read(uuid) from public, anon;
revoke execute on function public.user_business_role(uuid) from public, anon;
revoke execute on function public.user_has_business_access(uuid) from public, anon;
revoke execute on function public.user_can_manage_business(uuid) from public, anon;
revoke execute on function public.user_can_operate_business(uuid) from public, anon;
revoke execute on function public.user_can_configure_business(uuid) from public, anon;
revoke execute on function public.user_is_active_owner(uuid, uuid) from public, anon;
revoke execute on function public.count_active_business_owners(uuid) from public, anon;
revoke execute on function public.current_user_professional_id(uuid) from public, anon;
revoke execute on function public.user_has_active_professional_patient_link(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_basic_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_clinical_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_patient(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_radiology_reference(uuid, uuid) from public, anon;
revoke execute on function public.user_can_view_costs(uuid) from public, anon;
revoke execute on function public.user_can_read_professional_schedule(uuid, uuid) from public, anon;
revoke execute on function public.user_can_read_appointment(uuid, uuid) from public, anon;
revoke execute on function public.user_can_manage_users(uuid) from public, anon;
revoke execute on function public.upsert_patient_clinical_profile_safely(uuid, uuid, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) from public, anon;
revoke execute on function public.set_patient_drive_folder_safely(uuid, uuid, text) from public, anon;
revoke execute on function public.get_patient_drive_folder_safely(uuid, uuid) from public, anon;
revoke execute on function public.clear_patient_drive_folders_safely(uuid) from public, anon;
revoke execute on function public.replace_professional_availability_rules(uuid, uuid, int[], jsonb, int) from public, anon;
revoke execute on function public.professional_update_appointment_status(uuid, uuid, text) from public, anon;
revoke execute on function public.create_or_restore_professional_patient_link(uuid, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.link_patient_to_professional_safely(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.disable_professional_patient_link(uuid, text) from public, anon;
revoke execute on function public.add_business_user_by_email(uuid, text, text) from public, anon;
revoke execute on function public.change_business_user_role_safely(uuid, text) from public, anon;
revoke execute on function public.disable_business_user_safely(uuid, text) from public, anon;
revoke execute on function public.disable_allowed_email_safely(text, text) from public, anon;
revoke execute on function public.disable_allowed_email_as_master_safely(text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.link_professional_user_safely(uuid, uuid, uuid) from public, anon;
revoke execute on function public.unlink_professional_user_safely(uuid, uuid) from public, anon;

grant execute on function public.audit_security_event(uuid, uuid, text, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.business_commercial_status(uuid) to authenticated, service_role;
grant execute on function public.business_allows_operation(uuid) to authenticated, service_role;
grant execute on function public.business_allows_owner_restricted_read(uuid) to authenticated, service_role;
grant execute on function public.user_business_role(uuid) to authenticated;
grant execute on function public.user_has_business_access(uuid) to authenticated;
grant execute on function public.user_can_manage_business(uuid) to authenticated;
grant execute on function public.user_can_operate_business(uuid) to authenticated;
grant execute on function public.user_can_configure_business(uuid) to authenticated;
grant execute on function public.user_is_active_owner(uuid, uuid) to service_role;
grant execute on function public.count_active_business_owners(uuid) to service_role;
grant execute on function public.current_user_professional_id(uuid) to authenticated;
grant execute on function public.user_has_active_professional_patient_link(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_basic_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_clinical_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_patient(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_radiology_reference(uuid, uuid) to authenticated;
grant execute on function public.user_can_view_costs(uuid) to authenticated;
grant execute on function public.user_can_read_professional_schedule(uuid, uuid) to authenticated;
grant execute on function public.user_can_read_appointment(uuid, uuid) to authenticated;
grant execute on function public.user_can_manage_users(uuid) to authenticated;
grant execute on function public.upsert_patient_clinical_profile_safely(uuid, uuid, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.set_patient_archive_state_safely(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_patient_drive_folder_safely(uuid, uuid, text) to authenticated;
grant execute on function public.get_patient_drive_folder_safely(uuid, uuid) to authenticated;
grant execute on function public.clear_patient_drive_folders_safely(uuid) to authenticated;
grant execute on function public.replace_professional_availability_rules(uuid, uuid, int[], jsonb, int) to authenticated, service_role;
grant execute on function public.professional_update_appointment_status(uuid, uuid, text) to authenticated;
grant execute on function public.create_or_restore_professional_patient_link(uuid, uuid, uuid, text, uuid, uuid) to service_role;
grant execute on function public.link_patient_to_professional_safely(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.disable_professional_patient_link(uuid, text) to authenticated;
grant execute on function public.add_business_user_by_email(uuid, text, text) to authenticated;
grant execute on function public.change_business_user_role_safely(uuid, text) to authenticated;
grant execute on function public.disable_business_user_safely(uuid, text) to authenticated;
grant execute on function public.disable_allowed_email_safely(text, text) to authenticated;
grant execute on function public.disable_allowed_email_as_master_safely(text, uuid, text, text) to service_role;
grant execute on function public.link_professional_user_safely(uuid, uuid, uuid) to authenticated;
grant execute on function public.unlink_professional_user_safely(uuid, uuid) to authenticated;

alter table business_user_invites enable row level security;
alter table patient_clinical_profiles enable row level security;
alter table clinical_entry_costs enable row level security;
alter table professional_patient_links enable row level security;

drop policy if exists business_user_invites_select on business_user_invites;
create policy business_user_invites_select
	on business_user_invites
	for select
	to authenticated
	using (public.user_can_manage_users(business_id));

drop policy if exists patient_clinical_profiles_select on patient_clinical_profiles;
create policy patient_clinical_profiles_select
	on patient_clinical_profiles
	for select
	to authenticated
	using (public.user_can_read_clinical_patient(business_id, patient_id));

drop policy if exists patient_clinical_profiles_insert on patient_clinical_profiles;
create policy patient_clinical_profiles_insert
	on patient_clinical_profiles
	for insert
	to authenticated
	with check (public.user_business_role(business_id) in ('owner','admin') and public.business_allows_operation(business_id));

drop policy if exists patient_clinical_profiles_update on patient_clinical_profiles;
create policy patient_clinical_profiles_update
	on patient_clinical_profiles
	for update
	to authenticated
	using (public.user_business_role(business_id) in ('owner','admin') and public.business_allows_operation(business_id))
	with check (public.user_business_role(business_id) in ('owner','admin') and public.business_allows_operation(business_id));

drop policy if exists clinical_entry_costs_select on clinical_entry_costs;
create policy clinical_entry_costs_select
	on clinical_entry_costs
	for select
	to authenticated
	using (public.user_can_view_costs(business_id));

drop policy if exists clinical_entry_costs_insert on clinical_entry_costs;
create policy clinical_entry_costs_insert
	on clinical_entry_costs
	for insert
	to authenticated
	with check (public.user_can_view_costs(business_id));

drop policy if exists clinical_entry_costs_update on clinical_entry_costs;
create policy clinical_entry_costs_update
	on clinical_entry_costs
	for update
	to authenticated
	using (public.user_can_view_costs(business_id))
	with check (public.user_can_view_costs(business_id));

drop policy if exists clinical_entry_costs_delete on clinical_entry_costs;
create policy clinical_entry_costs_delete
	on clinical_entry_costs
	for delete
	to authenticated
	using (public.user_can_view_costs(business_id));

drop policy if exists professional_patient_links_select on professional_patient_links;
create policy professional_patient_links_select
	on professional_patient_links
	for select
	to authenticated
	using (
		public.user_business_role(business_id) in ('owner','admin')
		or (
			public.user_business_role(business_id) = 'professional'
			and exists (
				select 1
				from professional_users pu
				where pu.business_id = professional_patient_links.business_id
					and pu.professional_id = professional_patient_links.professional_id
					and pu.user_id = auth.uid()
			)
		)
	);

drop policy if exists professional_patient_links_write on professional_patient_links;
create policy professional_patient_links_write
	on professional_patient_links
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists audit_logs_select on audit_logs;
drop policy if exists audit_logs_insert on audit_logs;
drop policy if exists audit_logs_appointment_schedule_select on audit_logs;
drop policy if exists audit_logs_no_direct_insert on audit_logs;

create policy audit_logs_select
	on audit_logs
	for select
	to authenticated
	using (public.user_can_manage_business(business_id));

create policy audit_logs_no_direct_insert
	on audit_logs
	for insert
	to authenticated
	with check (false);

drop policy if exists messaging_accounts_select on messaging_accounts;
drop policy if exists messaging_accounts_write on messaging_accounts;
create policy messaging_accounts_select
	on messaging_accounts
	for select
	to authenticated
	using (public.user_can_configure_business(business_id));
create policy messaging_accounts_write
	on messaging_accounts
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists message_templates_select on message_templates;
drop policy if exists message_templates_write on message_templates;
create policy message_templates_select
	on message_templates
	for select
	to authenticated
	using (public.user_can_configure_business(business_id));
create policy message_templates_write
	on message_templates
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists message_dispatches_select on message_dispatches;
drop policy if exists message_dispatches_update on message_dispatches;
drop policy if exists message_dispatches_no_direct_update on message_dispatches;
create policy message_dispatches_select
	on message_dispatches
	for select
	to authenticated
	using (public.user_can_configure_business(business_id));
create policy message_dispatches_no_direct_update
	on message_dispatches
	for update
	to authenticated
	using (false)
	with check (false);

drop policy if exists inbound_messages_select on inbound_messages;
create policy inbound_messages_select
	on inbound_messages
	for select
	to authenticated
	using (public.user_can_configure_business(business_id));

drop policy if exists whatsapp_webhook_events_select on whatsapp_webhook_events;
create policy whatsapp_webhook_events_select
	on whatsapp_webhook_events
	for select
	to authenticated
	using (
		business_id is not null
		and public.user_can_configure_business(business_id)
	);

drop policy if exists patients_owner_select on patients;
drop policy if exists patients_owner_insert on patients;
drop policy if exists patients_owner_update on patients;
drop policy if exists patients_owner_delete on patients;
drop policy if exists patients_business_member_select on patients;
drop policy if exists patients_business_operator_insert on patients;
drop policy if exists patients_business_operator_update on patients;
drop policy if exists patients_business_admin_delete on patients;
drop policy if exists patients_role_scoped_select on patients;
drop policy if exists patients_no_direct_delete on patients;

create policy patients_role_scoped_select
	on patients
	for select
	to authenticated
	using (
		business_id is not null
		and public.user_can_read_basic_patient(business_id, id)
	);

create policy patients_business_operator_insert
	on patients
	for insert
	to authenticated
	with check (
		business_id is not null
		and public.user_can_operate_business(business_id)
	);

create policy patients_business_operator_update
	on patients
	for update
	to authenticated
	using (
		business_id is not null
		and public.user_can_operate_business(business_id)
	)
	with check (
		business_id is not null
		and public.user_can_operate_business(business_id)
	);

create policy patients_no_direct_delete
	on patients
	for delete
	to authenticated
	using (false);

drop policy if exists clinical_entries_owner_select on clinical_entries;
drop policy if exists clinical_entries_owner_insert on clinical_entries;
drop policy if exists clinical_entries_owner_update on clinical_entries;
drop policy if exists clinical_entries_owner_delete on clinical_entries;
drop policy if exists clinical_entries_business_member_select on clinical_entries;
drop policy if exists clinical_entries_business_operator_insert on clinical_entries;
drop policy if exists clinical_entries_business_operator_update on clinical_entries;
drop policy if exists clinical_entries_business_operator_delete on clinical_entries;
drop policy if exists clinical_entries_role_scoped_select on clinical_entries;
drop policy if exists clinical_entries_role_scoped_insert on clinical_entries;
drop policy if exists clinical_entries_role_scoped_update on clinical_entries;

create policy clinical_entries_role_scoped_select
	on clinical_entries
	for select
	to authenticated
	using (
		business_id is not null
		and public.user_can_read_clinical_patient(business_id, patient_id)
	);

create policy clinical_entries_role_scoped_insert
	on clinical_entries
	for insert
	to authenticated
	with check (
		business_id is not null
		and (
			(
				public.user_business_role(business_id) in ('owner','admin')
				and public.business_allows_operation(business_id)
				and created_by_user_id = auth.uid()
				and created_by_professional_id is null
			)
			or (
				public.user_business_role(business_id) = 'professional'
				and public.business_allows_operation(business_id)
				and created_by_user_id = auth.uid()
				and created_by_professional_id = public.current_user_professional_id(business_id)
				and exists (
					select 1
					from professional_patient_links ppl
					where ppl.business_id = clinical_entries.business_id
						and ppl.professional_id = clinical_entries.created_by_professional_id
						and ppl.patient_id = clinical_entries.patient_id
						and ppl.is_active = true
				)
			)
		)
	);

create policy clinical_entries_role_scoped_update
	on clinical_entries
	for update
	to authenticated
	using (
		business_id is not null
		and (
			(public.user_business_role(business_id) in ('owner','admin') and public.business_allows_operation(business_id))
			or (
				public.user_business_role(business_id) = 'professional'
				and public.business_allows_operation(business_id)
				and public.user_has_active_professional_patient_link(business_id, patient_id)
				and created_by_user_id = auth.uid()
				and now() <= coalesce(locked_after, created_at + interval '24 hours')
			)
		)
	)
	with check (
		business_id is not null
		and (
			(public.user_business_role(business_id) in ('owner','admin') and public.business_allows_operation(business_id))
			or (
				public.user_business_role(business_id) = 'professional'
				and public.business_allows_operation(business_id)
				and public.user_has_active_professional_patient_link(business_id, patient_id)
				and created_by_user_id = auth.uid()
				and now() <= coalesce(locked_after, created_at + interval '24 hours')
			)
		)
	);

drop policy if exists patient_radiographs_owner_select on patient_radiographs;
drop policy if exists patient_radiographs_owner_insert on patient_radiographs;
drop policy if exists patient_radiographs_owner_update on patient_radiographs;
drop policy if exists patient_radiographs_owner_delete on patient_radiographs;
drop policy if exists patient_radiographs_business_member_select on patient_radiographs;
drop policy if exists patient_radiographs_business_operator_insert on patient_radiographs;
drop policy if exists patient_radiographs_business_operator_update on patient_radiographs;
drop policy if exists patient_radiographs_business_operator_delete on patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_select on patient_radiographs;
drop policy if exists patient_radiographs_owner_admin_insert on patient_radiographs;
drop policy if exists patient_radiographs_owner_admin_update on patient_radiographs;
drop policy if exists patient_radiographs_owner_admin_delete on patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_insert on patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_update on patient_radiographs;
drop policy if exists patient_radiographs_role_scoped_delete on patient_radiographs;

create policy patient_radiographs_role_scoped_select
	on patient_radiographs
	for select
	to authenticated
	using (
		business_id is not null
		and public.user_can_read_radiology_reference(business_id, patient_id)
	);

create policy patient_radiographs_role_scoped_insert
	on patient_radiographs
	for insert
	to authenticated
	with check (
		business_id is not null
		and public.business_allows_operation(business_id)
		and (
			public.user_business_role(business_id) in ('owner','admin')
			or (
				public.user_business_role(business_id) = 'professional'
				and created_by = auth.uid()
				and public.user_has_active_professional_patient_link(business_id, patient_id)
			)
		)
	);

create policy patient_radiographs_role_scoped_update
	on patient_radiographs
	for update
	to authenticated
	using (
		business_id is not null
		and public.business_allows_operation(business_id)
		and (
			public.user_business_role(business_id) in ('owner','admin')
			or (
				public.user_business_role(business_id) = 'professional'
				and created_by = auth.uid()
				and public.user_has_active_professional_patient_link(business_id, patient_id)
			)
		)
	)
	with check (
		business_id is not null
		and public.business_allows_operation(business_id)
		and (
			public.user_business_role(business_id) in ('owner','admin')
			or (
				public.user_business_role(business_id) = 'professional'
				and created_by = auth.uid()
				and public.user_has_active_professional_patient_link(business_id, patient_id)
			)
		)
	);

create policy patient_radiographs_role_scoped_delete
	on patient_radiographs
	for delete
	to authenticated
	using (
		business_id is not null
		and public.business_allows_operation(business_id)
		and (
			public.user_business_role(business_id) in ('owner','admin')
			or (
				public.user_business_role(business_id) = 'professional'
				and created_by = auth.uid()
				and public.user_has_active_professional_patient_link(business_id, patient_id)
			)
		)
	);

drop policy if exists professionals_select on professionals;
create policy professionals_select
	on professionals
	for select
	to authenticated
	using (
		(
			public.user_business_role(business_id) in ('owner','admin','reception','readonly')
			and public.business_allows_operation(business_id)
		)
		or (
			public.user_business_role(business_id) = 'professional'
			and public.user_can_read_professional_schedule(business_id, id)
		)
	);

drop policy if exists professional_users_select on professional_users;
create policy professional_users_select
	on professional_users
	for select
	to authenticated
	using (
		user_id = auth.uid()
		or public.user_business_role(business_id) in ('owner','admin')
	);

drop policy if exists services_select on services;
create policy services_select
	on services
	for select
	to authenticated
	using (
		(
				public.user_business_role(business_id) in ('owner','admin','reception','readonly')
			and public.business_allows_operation(business_id)
		)
		or (
			public.user_business_role(business_id) = 'professional'
			and public.business_allows_operation(business_id)
			and exists (
				select 1
				from professional_services ps
				join professional_users pu
					on pu.business_id = ps.business_id
					and pu.professional_id = ps.professional_id
				where ps.business_id = services.business_id
					and ps.service_id = services.id
					and pu.user_id = auth.uid()
			)
		)
	);

drop policy if exists professional_services_select on professional_services;
create policy professional_services_select
	on professional_services
	for select
	to authenticated
	using (
		(
				public.user_business_role(business_id) in ('owner','admin','reception','readonly')
			and public.business_allows_operation(business_id)
		)
		or (
			public.user_business_role(business_id) = 'professional'
			and public.business_allows_operation(business_id)
			and exists (
				select 1
				from professional_users pu
				where pu.business_id = professional_services.business_id
					and pu.professional_id = professional_services.professional_id
					and pu.user_id = auth.uid()
			)
		)
	);

drop policy if exists availability_rules_select on availability_rules;
create policy availability_rules_select
	on availability_rules
	for select
	to authenticated
	using (public.user_can_read_professional_schedule(business_id, professional_id));

drop policy if exists availability_exceptions_select on availability_exceptions;
create policy availability_exceptions_select
	on availability_exceptions
	for select
	to authenticated
	using (
		(
			professional_id is null
				and public.user_business_role(business_id) in ('owner','admin','reception','readonly')
			and public.business_allows_operation(business_id)
		)
		or (
			professional_id is not null
			and public.user_can_read_professional_schedule(business_id, professional_id)
		)
	);

drop policy if exists professionals_insert on professionals;
drop policy if exists professionals_update on professionals;
create policy professionals_insert
	on professionals
	for insert
	to authenticated
	with check (public.user_can_configure_business(business_id));
create policy professionals_update
	on professionals
	for update
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists services_insert on services;
drop policy if exists services_update on services;
create policy services_insert
	on services
	for insert
	to authenticated
	with check (public.user_can_configure_business(business_id));
create policy services_update
	on services
	for update
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists professional_services_write on professional_services;
create policy professional_services_write
	on professional_services
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists availability_rules_write on availability_rules;
create policy availability_rules_write
	on availability_rules
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists availability_exceptions_write on availability_exceptions;
create policy availability_exceptions_write
	on availability_exceptions
	for all
	to authenticated
	using (public.user_can_configure_business(business_id))
	with check (public.user_can_configure_business(business_id));

drop policy if exists appointments_select on appointments;
create policy appointments_select
	on appointments
	for select
	to authenticated
	using (public.user_can_read_appointment(business_id, professional_id));

drop policy if exists appointments_insert on appointments;
drop policy if exists appointments_update on appointments;
create policy appointments_insert
	on appointments
	for insert
	to authenticated
	with check (public.user_can_operate_business(business_id));
create policy appointments_update
	on appointments
	for update
	to authenticated
	using (public.user_can_operate_business(business_id))
	with check (public.user_can_operate_business(business_id));

drop policy if exists business_users_select on business_users;
drop policy if exists business_users_insert on business_users;
drop policy if exists business_users_update on business_users;
drop policy if exists business_users_delete on business_users;
drop policy if exists "business admins can insert memberships" on business_users;
drop policy if exists "business admins can update memberships" on business_users;
drop policy if exists "business admins can delete memberships" on business_users;
create policy business_users_select
	on business_users
	for select
	to authenticated
	using (
		user_id = auth.uid()
		or public.user_can_manage_users(business_id)
	);

drop policy if exists business_users_no_direct_insert on business_users;
create policy business_users_no_direct_insert
	on business_users
	for insert
	to authenticated
	with check (false);

drop policy if exists business_users_no_direct_update on business_users;
create policy business_users_no_direct_update
	on business_users
	for update
	to authenticated
	using (false)
	with check (false);

drop policy if exists business_users_no_direct_delete on business_users;
create policy business_users_no_direct_delete
	on business_users
	for delete
	to authenticated
	using (false);

drop policy if exists access_grants_members_read on access_grants;
drop policy if exists "access_grants_members_read" on access_grants;
drop policy if exists access_grants_owner_admin_read on access_grants;
drop policy if exists access_grants_owner_read on access_grants;
create policy access_grants_owner_read
	on access_grants
	for select
	to authenticated
	using (public.user_business_role(business_id) = 'owner');

drop policy if exists business_subscriptions_members_read on business_subscriptions;
drop policy if exists "business_subscriptions_members_read" on business_subscriptions;
drop policy if exists business_subscriptions_owner_admin_read on business_subscriptions;
drop policy if exists business_subscriptions_owner_read on business_subscriptions;
create policy business_subscriptions_owner_read
	on business_subscriptions
	for select
	to authenticated
	using (public.user_business_role(business_id) = 'owner');

drop function if exists public.list_business_users(uuid);

create or replace function public.list_business_users(target_business_id uuid)
returns table(
	id uuid,
	business_id uuid,
	user_id uuid,
	email text,
	role text,
	status text,
	accepted_at timestamptz,
	last_seen_at timestamptz,
	created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
	if not public.user_can_manage_users(target_business_id) then
		raise exception 'BUSINESS_MANAGE_DENIED';
	end if;

	return query
	select
		bu.id,
		bu.business_id,
		bu.user_id,
		au.email::text,
		bu.role,
		coalesce(bu.status, 'active')::text,
		bu.accepted_at,
		bu.last_seen_at,
		bu.created_at
	from business_users bu
	left join auth.users au on au.id = bu.user_id
	where bu.business_id = target_business_id
		and coalesce(bu.status, 'active') = 'active'
	order by
		case bu.role
			when 'owner' then 1
			when 'admin' then 2
			when 'reception' then 3
			when 'professional' then 4
			else 5
		end,
		au.email nulls last;
	end;
	$$;

	revoke execute on function public.list_business_users(uuid) from public, anon;
	grant execute on function public.list_business_users(uuid) to authenticated;

notify pgrst, 'reload schema';
