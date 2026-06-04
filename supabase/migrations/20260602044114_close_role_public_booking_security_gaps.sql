create extension if not exists pgcrypto;

-- Cierra huecos de seguridad/UX posteriores a la migracion de roles:
-- - roles pendientes reales para emails sin cuenta
-- - profesionales incompletos creados desde el alta de rol profesional
-- - holds publicos expiran y no bloquean la agenda por dias
-- - rate limits con ventanas explicitas para superficies public/internal/master
-- - deduplicacion de auditoria con ventana para evitar saturacion

alter table professionals
	add column if not exists profile_status text not null default 'complete'
		check (profile_status in ('incomplete','complete')),
	add column if not exists name_source text not null default 'manual'
		check (name_source in ('manual','email_placeholder'));

update professionals
set
	profile_status = coalesce(profile_status, 'complete'),
	name_source = coalesce(name_source, 'manual')
where profile_status is null
	or name_source is null;

alter table business_user_invites
	add column if not exists professional_id uuid;

alter table patients
	add column if not exists origin text not null default 'manual'
		check (origin in ('manual','public_hold','public_booking','import')),
	add column if not exists origin_metadata jsonb not null default '{}'::jsonb,
	add column if not exists created_from_public_hold_at timestamptz,
	add column if not exists public_hold_archived_at timestamptz,
	add column if not exists internally_touched_at timestamptz,
	add column if not exists internally_touched_by uuid references auth.users(id);

update patients
set
	origin = coalesce(origin, 'manual'),
	origin_metadata = coalesce(origin_metadata, '{}'::jsonb)
where origin is null
	or origin_metadata is null;

alter table appointments
	add column if not exists hold_expires_at timestamptz,
	add column if not exists expired_at timestamptz,
	add column if not exists public_confirmed_at timestamptz,
	add column if not exists public_identity_hash text,
	add column if not exists public_phone_hash text,
	add column if not exists public_email_hash text,
	add column if not exists public_ip_hash text,
	add column if not exists public_device_hash text,
	add column if not exists public_identity_bundle_hash text,
	add column if not exists public_risk_score integer not null default 0 check (public_risk_score >= 0),
	add column if not exists public_risk_flags jsonb not null default '[]'::jsonb;

alter table public_booking_attempts
	add column if not exists email_hash text,
	add column if not exists device_hash text,
	add column if not exists identity_bundle_hash text,
	add column if not exists risk_score integer not null default 0 check (risk_score >= 0),
	add column if not exists risk_flags jsonb not null default '[]'::jsonb;

create table if not exists business_limits (
	business_id uuid primary key references businesses(id) on delete cascade,
	max_active_users integer not null default 20 check (max_active_users > 0),
	created_by uuid references auth.users(id),
	updated_by uuid references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

insert into business_limits (business_id)
select b.id
from businesses b
on conflict (business_id) do nothing;

create table if not exists platform_rate_limits (
	id uuid primary key default gen_random_uuid(),
	surface text not null check (surface in ('public','internal','master')),
	action text not null,
	scope_type text not null check (scope_type in ('ip','phone','email','device','identity_bundle','business','user')),
	window_seconds integer not null check (window_seconds > 0),
	limit_count integer not null check (limit_count > 0),
	enabled boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (surface, action, scope_type, window_seconds)
);

create table if not exists business_rate_limits (
	id uuid primary key default gen_random_uuid(),
	business_id uuid not null references businesses(id) on delete cascade,
	surface text not null check (surface in ('public','internal','master')),
	action text not null,
	scope_type text not null check (scope_type in ('ip','phone','email','device','identity_bundle','business','user')),
	window_seconds integer not null check (window_seconds > 0),
	limit_count integer not null check (limit_count > 0),
	enabled boolean not null default true,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, surface, action, scope_type, window_seconds)
);

create table if not exists rate_limit_counters (
	id uuid primary key default gen_random_uuid(),
	business_id uuid references businesses(id) on delete cascade,
	surface text not null check (surface in ('public','internal','master')),
	action text not null,
	scope_type text not null check (scope_type in ('ip','phone','email','device','identity_bundle','business','user')),
	scope_hash text not null,
	window_start timestamptz not null,
	window_seconds integer not null check (window_seconds > 0),
	counter integer not null default 1 check (counter > 0),
	expires_at timestamptz not null,
	first_seen_at timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (business_id, surface, action, scope_type, scope_hash, window_start, window_seconds)
);

create index if not exists rate_limit_counters_expires_idx
	on rate_limit_counters (expires_at);

create table if not exists audit_event_counters (
	id uuid primary key default gen_random_uuid(),
	business_id uuid references businesses(id) on delete cascade,
	actor_user_id uuid references auth.users(id),
	action text not null,
	resource_type text,
	resource_id uuid,
	reason_code text,
	dedupe_key text not null,
	window_start timestamptz not null,
	window_seconds integer not null check (window_seconds > 0),
	expires_at timestamptz not null,
	counter integer not null default 1 check (counter > 0),
	first_seen_at timestamptz not null default now(),
	last_seen_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique (dedupe_key, window_start, window_seconds)
);

create index if not exists audit_event_counters_expires_idx
	on audit_event_counters (expires_at);

create index if not exists business_user_invites_business_role_status_idx
	on business_user_invites (business_id, role, status, created_at desc);

create index if not exists business_user_invites_professional_idx
	on business_user_invites (business_id, professional_id)
	where professional_id is not null;

create index if not exists appointments_public_hold_expiry_idx
	on appointments (hold_expires_at)
	where status = 'pending_confirmation';

create index if not exists appointments_public_identity_future_idx
	on appointments (business_id, public_phone_hash, starts_at)
	where public_phone_hash is not null
		and status in ('pending_confirmation','reserved','confirmed','reschedule_requested');

insert into platform_rate_limits (surface, action, scope_type, window_seconds, limit_count)
values
	('public', 'availability_read', 'ip', 60, 10),
	('public', 'booking_create', 'ip', 3600, 5),
	('public', 'booking_create', 'phone', 86400, 3),
	('public', 'booking_create', 'identity_bundle', 3600, 3),
	('internal', 'role_assign', 'user', 3600, 30),
	('internal', 'patient_write', 'user', 3600, 120),
	('internal', 'appointment_write', 'user', 3600, 120),
	('internal', 'config_write', 'user', 3600, 60),
	('master', 'business_access_write', 'user', 3600, 100)
on conflict (surface, action, scope_type, window_seconds) do update
set
	limit_count = excluded.limit_count,
	enabled = true,
	updated_at = now();

do $$
declare
	v_invite record;
	v_professional_id uuid;
begin
	for v_invite in
		select bi.*
		from business_user_invites bi
		where bi.role = 'professional'
			and bi.professional_id is null
		order by bi.created_at asc
	loop
		insert into professionals (
			business_id,
			name,
			email,
			is_public,
			is_active,
			profile_status,
			name_source
		)
		values (
			v_invite.business_id,
			v_invite.email,
			v_invite.email,
			false,
			true,
			'incomplete',
			'email_placeholder'
		)
		returning id into v_professional_id;

		update business_user_invites
		set
			professional_id = v_professional_id,
			updated_at = now()
		where id = v_invite.id;
	end loop;
end $$;

do $$
begin
	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_user_invites_business_professional_fk'
	) then
		alter table business_user_invites
			add constraint business_user_invites_business_professional_fk
			foreign key (business_id, professional_id)
			references professionals (business_id, id)
			on delete restrict;
	end if;

	if not exists (
		select 1
		from pg_constraint
		where conname = 'business_user_invites_professional_required_chk'
	) then
		alter table business_user_invites
			add constraint business_user_invites_professional_required_chk
			check (role <> 'professional' or professional_id is not null);
	end if;
end $$;

alter table appointments
	drop constraint if exists appointments_status_check;

alter table appointments
	add constraint appointments_status_check
	check (
		status in (
			'pending_confirmation',
			'reserved',
			'confirmed',
			'cancelled',
			'reschedule_requested',
			'attended',
			'no_show',
			'expired'
		)
	);

alter table appointments
	drop constraint if exists appointments_no_overlapping_active;

alter table appointments
	add constraint appointments_no_overlapping_active
	exclude using gist (
		business_id with =,
		professional_id with =,
		tstzrange(blocking_starts_at, blocking_ends_at, '[)') with &&
	)
	where (status in ('pending_confirmation','reserved','confirmed','reschedule_requested'));

create or replace function public.window_start_for(p_now timestamptz, p_window_seconds integer)
returns timestamptz
language sql
immutable
as $$
	select to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
$$;

create or replace function public.check_and_increment_rate_limit(
	p_business_id uuid,
	p_surface text,
	p_action text,
	p_scope_type text,
	p_scope_hash text,
	p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_limit record;
	v_window_start timestamptz;
	v_counter integer;
begin
	if p_scope_hash is null or trim(p_scope_hash) = '' then
		return true;
	end if;

	if p_surface not in ('public','internal','master') then
		raise exception 'INVALID_RATE_LIMIT_SURFACE';
	end if;

	if p_scope_type not in ('ip','phone','email','device','identity_bundle','business','user') then
		raise exception 'INVALID_RATE_LIMIT_SCOPE';
	end if;

	select brl.window_seconds, brl.limit_count, brl.enabled
	into v_limit
	from business_rate_limits brl
	where brl.business_id = p_business_id
		and brl.surface = p_surface
		and brl.action = p_action
		and brl.scope_type = p_scope_type
		and brl.enabled = true
	order by brl.window_seconds asc
	limit 1;

	if not found then
		select prl.window_seconds, prl.limit_count, prl.enabled
		into v_limit
		from platform_rate_limits prl
		where prl.surface = p_surface
			and prl.action = p_action
			and prl.scope_type = p_scope_type
			and prl.enabled = true
		order by prl.window_seconds asc
		limit 1;
	end if;

	if not found or coalesce(v_limit.enabled, false) = false then
		return true;
	end if;

	v_window_start := public.window_start_for(p_now, v_limit.window_seconds);

	insert into rate_limit_counters (
		business_id,
		surface,
		action,
		scope_type,
		scope_hash,
		window_start,
		window_seconds,
		counter,
		expires_at,
		first_seen_at,
		last_seen_at
	)
	values (
		p_business_id,
		p_surface,
		p_action,
		p_scope_type,
		p_scope_hash,
		v_window_start,
		v_limit.window_seconds,
		1,
		v_window_start + make_interval(secs => v_limit.window_seconds * 2),
		p_now,
		p_now
	)
	on conflict (business_id, surface, action, scope_type, scope_hash, window_start, window_seconds)
	do update
	set
		counter = rate_limit_counters.counter + 1,
		last_seen_at = p_now,
		updated_at = p_now
	returning counter into v_counter;

	return v_counter <= v_limit.limit_count;
end;
$$;

create or replace function public.compact_audit_event_counter(
	p_business_id uuid,
	p_actor_user_id uuid,
	p_action text,
	p_resource_type text,
	p_resource_id uuid,
	p_reason_code text,
	p_dedupe_key text,
	p_window_seconds integer default 300,
	p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_window_start timestamptz;
	v_counter integer;
begin
	if nullif(trim(coalesce(p_dedupe_key, '')), '') is null then
		raise exception 'AUDIT_DEDUPE_KEY_REQUIRED';
	end if;

	v_window_start := public.window_start_for(p_now, p_window_seconds);

	insert into audit_event_counters (
		business_id,
		actor_user_id,
		action,
		resource_type,
		resource_id,
		reason_code,
		dedupe_key,
		window_start,
		window_seconds,
		expires_at,
		counter,
		first_seen_at,
		last_seen_at
	)
	values (
		p_business_id,
		p_actor_user_id,
		p_action,
		p_resource_type,
		p_resource_id,
		p_reason_code,
		p_dedupe_key,
		v_window_start,
		p_window_seconds,
		v_window_start + make_interval(secs => p_window_seconds * 12),
		1,
		p_now,
		p_now
	)
	on conflict (dedupe_key, window_start, window_seconds)
	do update
	set
		counter = audit_event_counters.counter + 1,
		last_seen_at = p_now,
		updated_at = p_now
	returning counter into v_counter;

	return v_counter;
end;
$$;

create or replace function public.expire_public_booking_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
	v_expired_count integer := 0;
begin
	with expired as (
		update appointments a
		set
			status = 'expired',
			expired_at = now(),
			updated_at = now()
		where a.status = 'pending_confirmation'
			and a.hold_expires_at is not null
			and a.hold_expires_at <= now()
		returning a.business_id, a.patient_id
	)
	select count(*)::integer into v_expired_count from expired;

	update patients p
	set
		archived_at = coalesce(p.archived_at, now()),
		public_hold_archived_at = now(),
		updated_at = now()
	where p.origin = 'public_hold'
		and p.public_hold_archived_at is null
		and exists (
			select 1
			from appointments a
			where a.business_id = p.business_id
				and a.patient_id = p.id
				and a.status = 'expired'
		)
		and not exists (
			select 1
			from appointments a
			where a.business_id = p.business_id
				and a.patient_id = p.id
				and a.status in ('pending_confirmation','reserved','confirmed','reschedule_requested')
				and a.starts_at >= now()
		)
		and not exists (
			select 1
			from clinical_entries ce
			where ce.business_id = p.business_id
				and ce.patient_id = p.id
		)
		and not exists (
			select 1
			from patient_radiographs pr
			where pr.business_id = p.business_id
				and pr.patient_id = p.id
		);

	return v_expired_count;
end;
$$;

create or replace function public.accept_pending_business_invites_for_user(
	p_email text,
	p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_email text := lower(trim(coalesce(p_email, '')));
	v_invite record;
	v_count integer := 0;
begin
	if v_email = '' or p_user_id is null then
		raise exception 'INVALID_INVITE_ACCEPTANCE';
	end if;

	if not exists (
		select 1
		from auth.users u
		where u.id = p_user_id
			and lower(u.email) = v_email
	) then
		raise exception 'AUTH_USER_EMAIL_MISMATCH';
	end if;

	for v_invite in
		select *
		from business_user_invites bi
		where lower(bi.email) = v_email
			and bi.status = 'pending'
			and bi.expires_at > now()
		order by bi.created_at asc
	loop
		if exists (
			select 1
			from business_users bu
			where bu.user_id = p_user_id
				and coalesce(bu.status, 'active') = 'active'
				and bu.business_id <> v_invite.business_id
		) then
			continue;
		end if;

		update allowed_emails
		set
			enabled = true,
			disabled_at = null,
			disabled_reason = null,
			updated_by = coalesce(v_invite.invited_by, updated_by),
			updated_at = now()
		where lower(email) = v_email;

		if not found then
			begin
				insert into allowed_emails (email, enabled, created_by, updated_by)
				values (v_email, true, v_invite.invited_by, v_invite.invited_by);
			exception when unique_violation then
				update allowed_emails
				set
					enabled = true,
					disabled_at = null,
					disabled_reason = null,
					updated_by = coalesce(v_invite.invited_by, updated_by),
					updated_at = now()
				where lower(email) = v_email;
			end;
		end if;

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
			v_invite.business_id,
			p_user_id,
			v_invite.role,
			'active',
			now(),
			v_invite.invited_by,
			v_invite.invited_by
		)
		on conflict (business_id, user_id) do update
		set
			role = excluded.role,
			status = 'active',
			accepted_at = coalesce(business_users.accepted_at, now()),
			disabled_at = null,
			disabled_reason = null,
			updated_by = excluded.updated_by,
			updated_at = now();

		if v_invite.role = 'professional' and v_invite.professional_id is not null then
			insert into professional_users (business_id, professional_id, user_id)
			values (v_invite.business_id, v_invite.professional_id, p_user_id)
			on conflict (business_id, professional_id, user_id) do nothing;
		end if;

		update business_user_invites
		set
			status = 'accepted',
			accepted_user_id = p_user_id,
			accepted_at = now(),
			updated_at = now()
		where id = v_invite.id;

		v_count := v_count + 1;
	end loop;

	return v_count;
end;
$$;

create or replace function public.assign_business_role_to_email_safely(
	target_business_id uuid,
	target_email text,
	target_role text,
	target_professional_id uuid default null,
	create_professional_profile boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_actor_role text;
	v_target_user_id uuid;
	v_target_email text := lower(trim(coalesce(target_email, '')));
	v_membership business_users%rowtype;
	v_membership_id uuid;
	v_invite_id uuid;
	v_professional_id uuid := target_professional_id;
	v_limit integer;
	v_used integer;
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

	if target_role = 'readonly' then
		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'ROLE_NOT_AVAILABLE', jsonb_build_object('target_role', target_role));
		raise exception 'ROLE_NOT_AVAILABLE';
	end if;

	if target_role not in ('owner','admin','reception','professional') then
		raise exception 'INVALID_ROLE';
	end if;

	if v_actor_role = 'admin' and target_role in ('owner','admin') then
		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'ADMIN_OWNER_ACTION_DENIED', jsonb_build_object('target_role', target_role));
		raise exception 'ADMIN_OWNER_ACTION_DENIED';
	end if;

	if v_target_email = '' or position('@' in v_target_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;

	perform pg_advisory_xact_lock(hashtext(v_target_email));

	if not public.check_and_increment_rate_limit(
		target_business_id,
		'internal',
		'role_assign',
		'user',
		auth.uid()::text
	) then
		raise exception 'INTERNAL_RATE_LIMITED';
	end if;

	select u.id
	into v_target_user_id
	from auth.users u
	where lower(u.email) = v_target_email
	limit 1;

	if not exists (
		select 1
		from business_users bu
		where bu.business_id = target_business_id
			and bu.user_id = v_target_user_id
			and coalesce(bu.status, 'active') = 'active'
	) and not exists (
		select 1
		from business_user_invites bi
		where bi.business_id = target_business_id
			and lower(bi.email) = v_target_email
			and bi.status = 'pending'
			and bi.expires_at > now()
	) then
		select coalesce(bl.max_active_users, 20)
		into v_limit
		from business_limits bl
		where bl.business_id = target_business_id;

		v_limit := coalesce(v_limit, 20);

		select count(*)::integer
		into v_used
		from (
			select bu.user_id::text as identity
			from business_users bu
			where bu.business_id = target_business_id
				and coalesce(bu.status, 'active') = 'active'
			union
			select lower(bi.email) as identity
			from business_user_invites bi
			where bi.business_id = target_business_id
				and bi.status = 'pending'
				and bi.expires_at > now()
		) used;

		if v_used >= v_limit then
			perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'BUSINESS_USER_LIMIT_REACHED', jsonb_build_object('limit', v_limit));
			raise exception 'BUSINESS_USER_LIMIT_REACHED';
		end if;
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
			and bi.expires_at > now()
			and bi.business_id <> target_business_id
	) then
		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.add', 'business_user', null, 'blocked', 'EMAIL_ALREADY_ASSIGNED', '{}'::jsonb);
		raise exception 'EMAIL_ALREADY_ASSIGNED';
	end if;

	if target_role = 'professional' then
		if v_professional_id is null and create_professional_profile then
			insert into professionals (
				business_id,
				name,
				email,
				is_public,
				is_active,
				profile_status,
				name_source
			)
			values (
				target_business_id,
				v_target_email,
				v_target_email,
				false,
				true,
				'incomplete',
				'email_placeholder'
			)
			returning id into v_professional_id;
		end if;

		if v_professional_id is null then
			raise exception 'PROFESSIONAL_LINK_REQUIRED';
		end if;

		if not exists (
			select 1
			from professionals p
			where p.business_id = target_business_id
				and p.id = v_professional_id
		) then
			raise exception 'PROFESSIONAL_NOT_FOUND';
		end if;
	else
		v_professional_id := null;
	end if;

	if v_target_user_id is null then
		update allowed_emails
		set
			enabled = true,
			disabled_at = null,
			disabled_reason = null,
			updated_by = auth.uid(),
			updated_at = now()
		where lower(email) = v_target_email;

		if not found then
			begin
				insert into allowed_emails (email, enabled, created_by, updated_by)
				values (v_target_email, true, auth.uid(), auth.uid());
			exception when unique_violation then
				update allowed_emails
				set
					enabled = true,
					disabled_at = null,
					disabled_reason = null,
					updated_by = auth.uid(),
					updated_at = now()
				where lower(email) = v_target_email;
			end;
		end if;

		select bi.id
		into v_invite_id
		from business_user_invites bi
		where lower(bi.email) = v_target_email
			and bi.status = 'pending'
		for update;

		if v_invite_id is not null then
			update business_user_invites
			set
				business_id = target_business_id,
				role = target_role,
				professional_id = v_professional_id,
				invited_by = auth.uid(),
				expires_at = now() + interval '14 days',
				updated_at = now()
			where id = v_invite_id;
		else
			insert into business_user_invites (
				business_id,
				email,
				role,
				professional_id,
				status,
				invited_by,
				expires_at
			)
			values (
				target_business_id,
				v_target_email,
				target_role,
				v_professional_id,
				'pending',
				auth.uid(),
				now() + interval '14 days'
			)
			returning id into v_invite_id;
		end if;

		perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.invited', 'business_user_invite', v_invite_id, 'success', null, jsonb_build_object('target_role', target_role, 'professional_id', v_professional_id));
		return v_invite_id;
	end if;

	update allowed_emails
	set
		enabled = true,
		disabled_at = null,
		disabled_reason = null,
		updated_by = auth.uid(),
		updated_at = now()
	where lower(email) = v_target_email;

	if not found then
		begin
			insert into allowed_emails (email, enabled, created_by, updated_by)
			values (v_target_email, true, auth.uid(), auth.uid());
		exception when unique_violation then
			update allowed_emails
			set
				enabled = true,
				disabled_at = null,
				disabled_reason = null,
				updated_by = auth.uid(),
				updated_at = now()
			where lower(email) = v_target_email;
		end;
	end if;

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

	if target_role = 'professional' then
		insert into professional_users (business_id, professional_id, user_id)
		values (target_business_id, v_professional_id, v_target_user_id)
		on conflict (business_id, professional_id, user_id) do nothing;
	end if;

	update business_user_invites
	set
		status = 'accepted',
		accepted_user_id = v_target_user_id,
		accepted_at = now(),
		updated_at = now()
	where business_id = target_business_id
		and lower(email) = v_target_email
		and status = 'pending';

	perform public.audit_security_event(target_business_id, auth.uid(), 'business_user.added_or_updated', 'business_user', v_membership_id, 'success', null, jsonb_build_object('target_role', target_role, 'professional_id', v_professional_id));
	return v_membership_id;
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
begin
	return public.assign_business_role_to_email_safely(
		target_business_id,
		target_email,
		target_role,
		null,
		target_role = 'professional'
	);
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
	if p_role = 'readonly' then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_change', 'business_user', p_membership_id, 'blocked', 'ROLE_NOT_AVAILABLE', jsonb_build_object('target_role', p_role));
		raise exception 'ROLE_NOT_AVAILABLE';
	end if;
	if p_role not in ('owner','admin','reception','professional') then
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
	if p_role = 'professional' and not exists (
		select 1
		from professional_users pu
		where pu.business_id = v_target.business_id
			and pu.user_id = v_target.user_id
	) then
		perform public.audit_security_event(v_target.business_id, auth.uid(), 'business_user.role_change', 'business_user', p_membership_id, 'blocked', 'PROFESSIONAL_LINK_REQUIRED', '{}'::jsonb);
		raise exception 'PROFESSIONAL_LINK_REQUIRED';
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

create or replace function public.reserve_public_booking_hold_safely(
	p_business_id uuid,
	p_service_id uuid,
	p_professional_id uuid,
	p_slot_starts_at timestamptz,
	p_patient_name text,
	p_phone_raw text,
	p_phone_e164 text,
	p_patient_email text default null,
	p_note text default null,
	p_ip_hash text default null,
	p_phone_hash text default null,
	p_email_hash text default null,
	p_device_hash text default null,
	p_identity_bundle_hash text default null,
	p_risk_score integer default 0,
	p_risk_flags jsonb default '[]'::jsonb,
	p_idempotency_key text default null,
	p_now timestamptz default now()
)
returns table(
	appointment_id uuid,
	confirmation_token text,
	hold_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_business record;
	v_service record;
	v_professional record;
	v_patient record;
	v_patient_id uuid;
	v_owner_id uuid;
	v_ends_at timestamptz;
	v_hold_expires_at timestamptz := p_now + interval '10 minutes';
	v_existing_attempt record;
	v_phone_hash text := nullif(trim(coalesce(p_phone_hash, '')), '');
	v_identity_hash text := coalesce(nullif(trim(coalesce(p_identity_bundle_hash, '')), ''), nullif(trim(coalesce(p_phone_hash, '')), ''), nullif(trim(coalesce(p_phone_e164, '')), ''));
begin
	perform public.expire_public_booking_holds();

	if p_business_id is null or p_service_id is null or p_professional_id is null or p_slot_starts_at is null then
		raise exception 'PUBLIC_BOOKING_INVALID_REQUEST';
	end if;

	if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
		raise exception 'PUBLIC_IDEMPOTENCY_REQUIRED';
	end if;

	if length(trim(coalesce(p_patient_name, ''))) < 3 then
		raise exception 'PUBLIC_PATIENT_NAME_INVALID';
	end if;

	if nullif(trim(coalesce(p_phone_e164, '')), '') is null then
		raise exception 'PUBLIC_PATIENT_PHONE_INVALID';
	end if;

	perform pg_advisory_xact_lock(hashtext(p_business_id::text || ':' || p_phone_e164));

	select *
	into v_business
	from businesses b
	where b.id = p_business_id
		and b.is_active = true
		and b.public_booking_enabled = true;

	if not found then
		raise exception 'PUBLIC_BOOKING_UNAVAILABLE';
	end if;

	if not public.business_allows_operation(p_business_id) then
		raise exception 'PUBLIC_BUSINESS_COMMERCIAL_UNAVAILABLE';
	end if;

	select pba.appointment_id, pba.phone_e164
	into v_existing_attempt
	from public_booking_attempts pba
	where pba.business_id = p_business_id
		and pba.action = 'booking_create'
		and pba.success = true
		and pba.idempotency_key = p_idempotency_key
	limit 1;

	if v_existing_attempt.appointment_id is not null then
		if v_existing_attempt.phone_e164 is distinct from p_phone_e164 then
			raise exception 'PUBLIC_DUPLICATE_SUBMIT';
		end if;

		return query
		select a.id, a.confirmation_token, a.hold_expires_at
		from appointments a
		where a.business_id = p_business_id
			and a.id = v_existing_attempt.appointment_id;
		return;
	end if;

	if not public.check_and_increment_rate_limit(p_business_id, 'public', 'booking_create', 'ip', p_ip_hash, p_now) then
		raise exception 'PUBLIC_RATE_LIMIT_IP';
	end if;
	if not public.check_and_increment_rate_limit(p_business_id, 'public', 'booking_create', 'phone', coalesce(v_phone_hash, p_phone_e164), p_now) then
		raise exception 'PUBLIC_RATE_LIMIT_PHONE';
	end if;
	if not public.check_and_increment_rate_limit(p_business_id, 'public', 'booking_create', 'identity_bundle', p_identity_bundle_hash, p_now) then
		raise exception 'PUBLIC_RATE_LIMIT_IDENTITY';
	end if;

	select s.*
	into v_service
	from services s
	where s.business_id = p_business_id
		and s.id = p_service_id
		and s.is_active = true
		and s.is_public = true;
	if not found then
		raise exception 'SERVICE_NOT_FOUND';
	end if;

	select p.*
	into v_professional
	from professionals p
	where p.business_id = p_business_id
		and p.id = p_professional_id
		and p.is_active = true
		and p.is_public = true
		and coalesce(p.profile_status, 'complete') = 'complete'
		and coalesce(p.name_source, 'manual') = 'manual';
	if not found then
		raise exception 'PROFESSIONAL_NOT_FOUND';
	end if;

	if not exists (
		select 1
		from professional_services ps
		where ps.business_id = p_business_id
			and ps.professional_id = p_professional_id
			and ps.service_id = p_service_id
	) then
		raise exception 'PROFESSIONAL_SERVICE_NOT_ASSIGNED';
	end if;

	v_ends_at := p_slot_starts_at + make_interval(mins => v_service.duration_minutes);
	if p_slot_starts_at < p_now + make_interval(mins => coalesce(v_business.min_booking_notice_minutes, 0)) then
		raise exception 'PUBLIC_SLOT_UNAVAILABLE';
	end if;

	select p.id, p.blocked, p.origin
	into v_patient
	from patients p
	where p.business_id = p_business_id
		and p.phone_e164 = p_phone_e164
	limit 1
	for update;

	if v_patient.blocked then
		raise exception 'PUBLIC_BOOKING_BLOCKED_PATIENT';
	end if;

	if v_patient.id is not null then
		v_patient_id := v_patient.id;
	else
		select bu.user_id
		into v_owner_id
		from business_users bu
		where bu.business_id = p_business_id
			and bu.role = 'owner'
			and coalesce(bu.status, 'active') = 'active'
		order by bu.created_at asc
		limit 1;

		if v_owner_id is null then
			raise exception 'PATIENT_OWNER_REQUIRED';
		end if;

		insert into patients (
			business_id,
			owner_id,
			full_name,
			phone,
			phone_raw,
			phone_e164,
			email,
			origin,
			origin_metadata,
			created_from_public_hold_at
		)
		values (
			p_business_id,
			v_owner_id,
			trim(p_patient_name),
			regexp_replace(p_phone_e164, '\D', '', 'g'),
			nullif(trim(coalesce(p_phone_raw, '')), ''),
			p_phone_e164,
			nullif(trim(coalesce(p_patient_email, '')), ''),
			'public_hold',
			jsonb_build_object('source', 'public_booking_hold'),
			p_now
		)
		returning id into v_patient_id;
	end if;

	if (
		select count(*)::integer
		from appointments a
		where a.business_id = p_business_id
			and a.patient_id = v_patient_id
			and a.status in ('pending_confirmation','reserved','confirmed','reschedule_requested')
			and a.starts_at >= p_now
	) >= 2 then
		raise exception 'PUBLIC_BOOKING_ACTIVE_LIMIT';
	end if;

	if exists (
		select 1
		from appointments a
		where a.business_id = p_business_id
			and a.professional_id = p_professional_id
			and a.status in ('pending_confirmation','reserved','confirmed','reschedule_requested')
			and tstzrange(a.blocking_starts_at, a.blocking_ends_at, '[)') &&
				tstzrange(
					p_slot_starts_at - make_interval(mins => coalesce(v_service.buffer_before_minutes, 0)),
					v_ends_at + make_interval(mins => coalesce(v_service.buffer_after_minutes, 0)),
					'[)'
				)
	) then
		raise exception 'PUBLIC_SLOT_UNAVAILABLE';
	end if;

	insert into appointments (
		business_id,
		patient_id,
		service_id,
		professional_id,
		starts_at,
		ends_at,
		blocking_starts_at,
		blocking_ends_at,
		status,
		source,
		reminder_due_at,
		internal_note,
		created_by_user_id,
		updated_by_user_id,
		service_name_snapshot,
		professional_name_snapshot,
		duration_minutes_snapshot,
		hold_expires_at,
		public_identity_hash,
		public_phone_hash,
		public_email_hash,
		public_ip_hash,
		public_device_hash,
		public_identity_bundle_hash,
		public_risk_score,
		public_risk_flags
	)
	values (
		p_business_id,
		v_patient_id,
		p_service_id,
		p_professional_id,
		p_slot_starts_at,
		v_ends_at,
		p_slot_starts_at,
		v_ends_at,
		'pending_confirmation',
		'public_booking',
		null,
		nullif(trim(coalesce(p_note, '')), ''),
		null,
		null,
		v_service.name,
		v_professional.name,
		v_service.duration_minutes,
		v_hold_expires_at,
		v_identity_hash,
		v_phone_hash,
		nullif(trim(coalesce(p_email_hash, '')), ''),
		nullif(trim(coalesce(p_ip_hash, '')), ''),
		nullif(trim(coalesce(p_device_hash, '')), ''),
		nullif(trim(coalesce(p_identity_bundle_hash, '')), ''),
		coalesce(p_risk_score, 0),
		coalesce(p_risk_flags, '[]'::jsonb)
	)
	returning appointments.id, appointments.confirmation_token, appointments.hold_expires_at
	into appointment_id, confirmation_token, hold_expires_at;

	insert into public_booking_attempts (
		business_id,
		phone_e164,
		ip_hash,
		email_hash,
		device_hash,
		identity_bundle_hash,
		action,
		success,
		user_agent,
		idempotency_key,
		appointment_id,
		risk_score,
		risk_flags,
		metadata
	)
	values (
		p_business_id,
		p_phone_e164,
		nullif(trim(coalesce(p_ip_hash, '')), ''),
		nullif(trim(coalesce(p_email_hash, '')), ''),
		nullif(trim(coalesce(p_device_hash, '')), ''),
		nullif(trim(coalesce(p_identity_bundle_hash, '')), ''),
		'booking_create',
		true,
		null,
		p_idempotency_key,
		appointment_id,
		coalesce(p_risk_score, 0),
		coalesce(p_risk_flags, '[]'::jsonb),
		jsonb_build_object('status', 'pending_confirmation')
	);

	perform public.audit_security_event(
		p_business_id,
		null,
		'appointment.public_hold_created',
		'appointment',
		appointment_id,
		'success',
		null,
		jsonb_build_object('patient_id', v_patient_id, 'hold_expires_at', hold_expires_at)
	);

	return next;
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
begin
	perform p_email, p_actor_id, p_actor_email, p_reason;
	raise exception 'MASTER_RPC_REQUIRES_AUTHENTICATED_MASTER';
end;
$$;

create or replace function public.disable_allowed_email_as_authenticated_master_safely(
	p_email text,
	p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
	v_master_email text := lower(trim(coalesce(nullif(current_setting('app.master_email', true), ''), 'juanpabloaltamira@protonmail.com')));
	v_actor_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
	v_actor_id uuid := auth.uid();
	v_email text := lower(trim(coalesce(p_email, '')));
	v_target_user_id uuid;
	v_target record;
begin
	if v_master_email = '' then
		raise exception 'MASTER_EMAIL_NOT_CONFIGURED';
	end if;
	if v_actor_id is null or v_actor_email <> v_master_email then
		raise exception 'MASTER_ACCESS_DENIED';
	end if;
	if v_email = '' or position('@' in v_email) = 0 then
		raise exception 'INVALID_EMAIL';
	end if;
	if v_email = v_master_email then
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
			perform public.audit_security_event(v_target.business_id, v_actor_id, 'allowed_email.master_disable', 'allowed_email', null, 'blocked', 'LAST_OWNER_BLOCKED', '{}'::jsonb);
			raise exception 'LAST_OWNER_BLOCKED';
		end if;
	end loop;

	update allowed_emails
	set
		enabled = false,
		disabled_at = now(),
		disabled_reason = nullif(trim(coalesce(p_reason, '')), ''),
		updated_by = v_actor_id,
		updated_at = now()
	where lower(email) = v_email;

	if not found then
		raise exception 'ALLOWED_EMAIL_NOT_FOUND';
	end if;

	perform public.audit_security_event(null, v_actor_id, 'allowed_email.master_disabled', 'allowed_email', null, 'success', null, '{}'::jsonb);
end;
$$;

revoke all on table business_limits from anon, authenticated;
revoke all on table platform_rate_limits from anon, authenticated;
revoke all on table business_rate_limits from anon, authenticated;
revoke all on table rate_limit_counters from anon, authenticated;
revoke all on table audit_event_counters from anon, authenticated;

alter table business_limits enable row level security;
alter table platform_rate_limits enable row level security;
alter table business_rate_limits enable row level security;
alter table rate_limit_counters enable row level security;
alter table audit_event_counters enable row level security;

drop policy if exists business_limits_manage_select on business_limits;
create policy business_limits_manage_select
	on business_limits
	for select
	to authenticated
	using (public.user_can_manage_users(business_id));

drop policy if exists business_rate_limits_manage_select on business_rate_limits;
create policy business_rate_limits_manage_select
	on business_rate_limits
	for select
	to authenticated
	using (public.user_can_manage_users(business_id));

revoke execute on function public.check_and_increment_rate_limit(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.compact_audit_event_counter(uuid, uuid, text, text, uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.expire_public_booking_holds() from public, anon, authenticated;
revoke execute on function public.accept_pending_business_invites_for_user(text, uuid) from public, anon;
revoke execute on function public.assign_business_role_to_email_safely(uuid, text, text, uuid, boolean) from public, anon;
revoke execute on function public.reserve_public_booking_hold_safely(uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, integer, jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.disable_allowed_email_as_authenticated_master_safely(text, text) from public, anon;

grant execute on function public.check_and_increment_rate_limit(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.compact_audit_event_counter(uuid, uuid, text, text, uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.expire_public_booking_holds() to authenticated, service_role;
grant execute on function public.accept_pending_business_invites_for_user(text, uuid) to authenticated, service_role;
grant execute on function public.assign_business_role_to_email_safely(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.reserve_public_booking_hold_safely(uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, text, text, text, text, integer, jsonb, text, timestamptz) to service_role;
grant execute on function public.disable_allowed_email_as_authenticated_master_safely(text, text) to authenticated;

notify pgrst, 'reload schema';
