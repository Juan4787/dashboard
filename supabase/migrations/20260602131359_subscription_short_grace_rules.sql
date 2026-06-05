create or replace function public.business_subscription_grace_until(
	p_paid_until timestamptz,
	p_duration_seconds integer,
	p_duration_unit text
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
	select case
		when p_paid_until is null then null
		when coalesce(p_duration_seconds, 0) in (3600, 86400)
			and coalesce(p_duration_unit, '') in ('', 'hour', 'day', 'manual')
			then p_paid_until
		else p_paid_until + interval '48 hours'
	end;
$$;

create or replace function public.business_subscription_restricted_until(
	p_paid_until timestamptz,
	p_duration_seconds integer,
	p_duration_unit text
)
returns timestamptz
language sql
immutable
set search_path = public
as $$
	select case
		when p_paid_until is null then null
		else public.business_subscription_grace_until(p_paid_until, p_duration_seconds, p_duration_unit) + interval '30 days'
	end;
$$;

create or replace function public.business_subscription_uses_expiration_notice(
	p_duration_seconds integer
)
returns boolean
language sql
immutable
set search_path = public
as $$
	select coalesce(p_duration_seconds, 0) >= 604800;
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
				public.business_subscription_grace_until(
					bs.paid_until,
					bs.last_grant_duration_seconds,
					null
				),
				public.business_subscription_restricted_until(
					bs.paid_until,
					bs.last_grant_duration_seconds,
					null
				),
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

with normalized as (
	select
		bs.business_id,
		public.business_subscription_grace_until(
			bs.paid_until,
			bs.last_grant_duration_seconds,
			null
		) as next_grace_until,
		public.business_subscription_restricted_until(
			bs.paid_until,
			bs.last_grant_duration_seconds,
			null
		) as next_restricted_until,
		case
			when bs.is_permanent then false
			when bs.last_grant_duration_seconds in (3600, 86400) then false
			when public.business_subscription_uses_expiration_notice(bs.last_grant_duration_seconds) then true
			else bs.expiration_notice_enabled
		end as next_expiration_notice_enabled,
		public.compute_business_subscription_status(
			bs.commercial_access_enabled,
			bs.is_permanent,
			bs.paid_until,
			public.business_subscription_grace_until(
				bs.paid_until,
				bs.last_grant_duration_seconds,
				null
			),
			public.business_subscription_restricted_until(
				bs.paid_until,
				bs.last_grant_duration_seconds,
				null
			),
			bs.archived_at
		) as next_subscription_status
	from business_subscriptions bs
	where bs.paid_until is not null
		and bs.is_permanent = false
		and bs.last_grant_duration_seconds is not null
)
update business_subscriptions bs
set
	grace_until = n.next_grace_until,
	restricted_until = n.next_restricted_until,
	expiration_notice_enabled = n.next_expiration_notice_enabled,
	subscription_status = n.next_subscription_status,
	updated_at = now()
from normalized n
where n.business_id = bs.business_id
	and (
		bs.grace_until is distinct from n.next_grace_until
		or bs.restricted_until is distinct from n.next_restricted_until
		or bs.expiration_notice_enabled is distinct from n.next_expiration_notice_enabled
		or bs.subscription_status is distinct from n.next_subscription_status
	);

create or replace function public.grant_business_access(
	p_business_id uuid,
	p_operation text,
	p_duration_seconds integer,
	p_duration_unit text,
	p_is_permanent boolean,
	p_amount numeric,
	p_source text,
	p_note text,
	p_admin_id uuid,
	p_admin_email text,
	p_idempotency_key text
)
returns table (
	applied boolean,
	grant_id uuid,
	paid_until_before timestamptz,
	paid_until_after timestamptz,
	status_after text
)
language plpgsql
security definer
set search_path = public
as $$
declare
	v_now timestamptz := now();
	v_sub business_subscriptions%rowtype;
	v_new_paid_until timestamptz;
	v_new_grace_until timestamptz;
	v_new_restricted_until timestamptz;
	v_new_archived_at timestamptz;
	v_new_is_permanent boolean;
	v_new_enabled boolean;
	v_new_status text;
	v_grant_id uuid;
	v_existing access_grants%rowtype;
	v_source text := coalesce(nullif(trim(p_source), ''), 'manual');
	v_note text := nullif(trim(coalesce(p_note, '')), '');
	v_duration_seconds integer := p_duration_seconds;
begin
	if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
		raise exception 'idempotency_key is required';
	end if;

	if p_operation not in (
		'grant_access',
		'extend_access',
		'reduce_access',
		'set_permanent',
		'unset_permanent',
		'disable_business_access',
		'enable_business_access',
		'archive_business',
		'reactivate_business',
		'manual_correction',
		'payment_registered',
		'payment_cancelled'
	) then
		raise exception 'invalid operation';
	end if;

	if v_source not in ('manual','mercado_pago','promo','internal') then
		raise exception 'invalid source';
	end if;

	insert into business_subscriptions (business_id, is_permanent, subscription_status, access_note)
	values (
		p_business_id,
		coalesce(p_is_permanent, false)
			or p_operation in ('set_permanent','disable_business_access','enable_business_access','archive_business','payment_cancelled'),
		'active',
		'Fila creada automaticamente por grant_business_access.'
	)
	on conflict (business_id) do nothing;

	select *
	into v_sub
	from business_subscriptions
	where business_id = p_business_id
	for update;

	if not found then
		raise exception 'business subscription not found';
	end if;

	select *
	into v_existing
	from access_grants
	where idempotency_key = p_idempotency_key;

	if found then
		if v_existing.business_id is distinct from p_business_id
			or v_existing.operation is distinct from p_operation
			or coalesce(v_existing.duration_unit, '') is distinct from coalesce(p_duration_unit, '')
			or coalesce(v_existing.duration_seconds, 0) is distinct from coalesce(v_duration_seconds, 0)
			or coalesce(v_existing.is_permanent_grant, false) is distinct from (coalesce(p_is_permanent, false) or p_operation = 'set_permanent')
			or v_existing.amount is distinct from p_amount
			or coalesce(v_existing.source, '') is distinct from v_source
			or coalesce(v_existing.note, '') is distinct from coalesce(v_note, '')
			or v_existing.admin_id is distinct from p_admin_id
			or coalesce(v_existing.admin_email, '') is distinct from coalesce(p_admin_email, '') then
			raise exception 'idempotency key reused with different payload';
		end if;

		return query
		select false, v_existing.id, v_existing.paid_until_before, v_existing.paid_until_after, v_existing.status_after;
		return;
	end if;

	v_new_paid_until := v_sub.paid_until;
	v_new_grace_until := v_sub.grace_until;
	v_new_restricted_until := v_sub.restricted_until;
	v_new_archived_at := v_sub.archived_at;
	v_new_is_permanent := v_sub.is_permanent;
	v_new_enabled := v_sub.commercial_access_enabled;

	if p_operation in ('grant_access','extend_access','payment_registered') then
		if coalesce(v_duration_seconds, 0) <= 0 then
			raise exception 'duration must be positive';
		end if;
		if v_sub.is_permanent then
			raise exception 'cannot add duration to permanent subscription';
		end if;

		v_new_paid_until := greatest(coalesce(v_sub.paid_until, v_now), v_now) + make_interval(secs => v_duration_seconds);
		v_new_grace_until := public.business_subscription_grace_until(v_new_paid_until, v_duration_seconds, p_duration_unit);
		v_new_restricted_until := public.business_subscription_restricted_until(v_new_paid_until, v_duration_seconds, p_duration_unit);
		v_new_archived_at := null;
		v_new_enabled := true;
	elsif p_operation in ('reduce_access','manual_correction') then
		if coalesce(v_duration_seconds, 0) <= 0 then
			raise exception 'duration must be positive';
		end if;
		if v_sub.is_permanent then
			raise exception 'cannot reduce permanent subscription';
		end if;

		v_new_paid_until := coalesce(v_sub.paid_until, v_now) - make_interval(secs => v_duration_seconds);
		if v_new_paid_until < v_now then
			v_new_paid_until := v_now;
		end if;
		v_new_grace_until := public.business_subscription_grace_until(v_new_paid_until, v_sub.last_grant_duration_seconds, null);
		v_new_restricted_until := public.business_subscription_restricted_until(v_new_paid_until, v_sub.last_grant_duration_seconds, null);
		v_new_archived_at := null;
	elsif p_operation = 'set_permanent' then
		v_new_is_permanent := true;
		v_new_enabled := true;
		v_new_paid_until := null;
		v_new_grace_until := null;
		v_new_restricted_until := null;
		v_new_archived_at := null;
		v_duration_seconds := null;
	elsif p_operation = 'unset_permanent' then
		if not v_sub.is_permanent then
			raise exception 'subscription is not permanent';
		end if;
		v_new_is_permanent := false;
		v_new_paid_until := v_now;
		v_new_grace_until := v_now + interval '48 hours';
		v_new_restricted_until := v_new_grace_until + interval '30 days';
		v_new_archived_at := null;
		v_duration_seconds := null;
	elsif p_operation = 'disable_business_access' then
		v_new_enabled := false;
		v_duration_seconds := null;
	elsif p_operation = 'enable_business_access' then
		v_new_enabled := true;
		v_duration_seconds := null;
	elsif p_operation = 'archive_business' then
		v_new_archived_at := v_now;
		v_new_enabled := false;
		v_duration_seconds := null;
	elsif p_operation = 'reactivate_business' then
		if coalesce(v_duration_seconds, 0) <= 0 and coalesce(p_is_permanent, false) = false then
			raise exception 'reactivation requires duration or permanent flag';
		end if;
		v_new_enabled := true;
		v_new_archived_at := null;
		if coalesce(p_is_permanent, false) then
			v_new_is_permanent := true;
			v_new_paid_until := null;
			v_new_grace_until := null;
			v_new_restricted_until := null;
			v_duration_seconds := null;
		else
			v_new_is_permanent := false;
			v_new_paid_until := v_now + make_interval(secs => v_duration_seconds);
			v_new_grace_until := public.business_subscription_grace_until(v_new_paid_until, v_duration_seconds, p_duration_unit);
			v_new_restricted_until := public.business_subscription_restricted_until(v_new_paid_until, v_duration_seconds, p_duration_unit);
		end if;
	elsif p_operation = 'payment_cancelled' then
		v_duration_seconds := null;
	end if;

	v_new_status := public.compute_business_subscription_status(
		v_new_enabled,
		v_new_is_permanent,
		v_new_paid_until,
		v_new_grace_until,
		v_new_restricted_until,
		v_new_archived_at
	);

	update business_subscriptions
	set
		commercial_access_enabled = v_new_enabled,
		is_permanent = v_new_is_permanent,
		subscription_status = v_new_status,
		paid_until = v_new_paid_until,
		grace_until = v_new_grace_until,
		restricted_until = v_new_restricted_until,
		archived_at = v_new_archived_at,
		last_payment_at = case
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') then v_now
			else last_payment_at
		end,
		last_payment_amount = case
			when p_amount is not null then p_amount
			else last_payment_amount
		end,
		last_grant_duration_seconds = case
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and v_duration_seconds is not null then v_duration_seconds
			else last_grant_duration_seconds
		end,
		expiration_notice_enabled = case
			when v_new_is_permanent then false
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and public.business_subscription_uses_expiration_notice(v_duration_seconds) then true
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and coalesce(v_duration_seconds, 0) in (3600, 86400) then false
			when p_operation in ('grant_access','extend_access','payment_registered','reactivate_business') and expiration_notice_enabled then true
			else expiration_notice_enabled
		end,
		access_source = v_source,
		access_note = coalesce(v_note, access_note),
		updated_by = p_admin_id
	where business_id = p_business_id;

	insert into access_grants (
		business_id,
		operation,
		duration_unit,
		duration_seconds,
		is_permanent_grant,
		amount,
		source,
		note,
		admin_id,
		admin_email,
		idempotency_key,
		paid_until_before,
		paid_until_after,
		grace_until_before,
		grace_until_after,
		restricted_until_before,
		restricted_until_after,
		is_permanent_before,
		is_permanent_after,
		enabled_before,
		enabled_after,
		status_before,
		status_after
	)
	values (
		p_business_id,
		p_operation,
		p_duration_unit,
		v_duration_seconds,
		coalesce(p_is_permanent, false) or p_operation = 'set_permanent',
		p_amount,
		v_source,
		v_note,
		p_admin_id,
		nullif(trim(coalesce(p_admin_email, '')), ''),
		p_idempotency_key,
		v_sub.paid_until,
		v_new_paid_until,
		v_sub.grace_until,
		v_new_grace_until,
		v_sub.restricted_until,
		v_new_restricted_until,
		v_sub.is_permanent,
		v_new_is_permanent,
		v_sub.commercial_access_enabled,
		v_new_enabled,
		v_sub.subscription_status,
		v_new_status
	)
	returning id into v_grant_id;

	return query
	select true, v_grant_id, v_sub.paid_until, v_new_paid_until, v_new_status;
end;
$$;

revoke execute on function public.business_subscription_grace_until(timestamptz, integer, text) from public, anon, authenticated;
revoke execute on function public.business_subscription_restricted_until(timestamptz, integer, text) from public, anon, authenticated;
revoke execute on function public.business_subscription_uses_expiration_notice(integer) from public, anon, authenticated;
revoke execute on function public.business_commercial_status(uuid) from public, anon;
revoke execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	from public, anon, authenticated;

grant execute on function public.business_subscription_grace_until(timestamptz, integer, text) to service_role;
grant execute on function public.business_subscription_restricted_until(timestamptz, integer, text) to service_role;
grant execute on function public.business_subscription_uses_expiration_notice(integer) to service_role;
grant execute on function public.business_commercial_status(uuid) to authenticated, service_role;
grant execute on function public.grant_business_access(uuid, text, integer, text, boolean, numeric, text, text, uuid, text, text)
	to service_role;

notify pgrst, 'reload schema';
