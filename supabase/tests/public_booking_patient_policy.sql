-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking_patient_policy.sql
--
-- Transactional integration test: leaves no rows behind.

begin;

select extensions.plan(1);

do $$
declare
	v_business_id uuid;
	v_owner_id uuid := gen_random_uuid();
	v_service_id uuid;
	v_professional_id uuid;
	v_ana_phone_a_id uuid;
	v_ana_phone_b_id uuid;
	v_bruno_id uuid;
	v_future_to_cancel_id uuid;
	v_start timestamptz;
	v_count integer;
	v_limit_error text;
	i integer;
begin
	insert into auth.users (id, email)
	values (v_owner_id, 'public-booking-patient-policy@example.test');

	insert into public.businesses (name, slug, industry, timezone)
	values (
		'E2E politica de pacientes',
		'e2e-patient-policy-' || gen_random_uuid()::text,
		'odontology',
		'America/Argentina/Buenos_Aires'
	)
	returning id into v_business_id;

	insert into public.services (
		business_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes
	)
	values (v_business_id, 'Consulta E2E', 30, 0, 0)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional E2E')
	returning id into v_professional_id;

	insert into public.professional_services (business_id, professional_id, service_id)
	values (v_business_id, v_professional_id, v_service_id);

	-- El mismo nombre puede existir en dos fichas con teléfonos distintos. Esas
	-- fichas comparten el cupo público, pero no se fusionan ni se sobrescriben.
	insert into public.patients (owner_id, business_id, full_name, phone_e164)
	values (v_owner_id, v_business_id, 'Ana Gómez', '+5493510000101')
	returning id into v_ana_phone_a_id;

	insert into public.patients (owner_id, business_id, full_name, phone_e164)
	values (v_owner_id, v_business_id, '  ANA   GOMEZ  ', '+5493510000102')
	returning id into v_ana_phone_b_id;

	insert into public.patients (owner_id, business_id, full_name, phone_e164)
	values (v_owner_id, v_business_id, 'Bruno Gomez', '+5493510000103')
	returning id into v_bruno_id;

	if public.normalized_patient_name('  MARÍA   GIMÉNEZ ') <> 'maria gimenez' then
		raise exception 'TEST_ACCENT_INSENSITIVE_NAME_NORMALIZATION';
	end if;
	if public.normalized_patient_name('Ana Peña') = public.normalized_patient_name('Ana Pena') then
		raise exception 'TEST_ENYE_MUST_REMAIN_DISTINCT';
	end if;

	-- Un historial grande no consume cupo si ya quedó atrás.
	for i in 1..345 loop
		v_start := statement_timestamp() - make_interval(days => i);
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id, v_ana_phone_a_id, v_service_id, v_professional_id,
			v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
			'confirmed', 'public_booking', 'Pendiente', 'Pendiente', 30
		);
	end loop;

	-- Los cuatro turnos activos se reparten entre dos teléfonos, y cuentan
	-- juntos por nombre normalizado. Los turnos manuales también consumen cupo.
	for i in 1..4 loop
		v_start := statement_timestamp() + make_interval(days => i);
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id,
			case when i <= 2 then v_ana_phone_a_id else v_ana_phone_b_id end,
			v_service_id,
			v_professional_id,
			v_start,
			v_start + interval '30 minutes',
			v_start,
			v_start + interval '30 minutes',
			case when i = 2 then 'confirmed' when i = 3 then 'reschedule_requested' else 'reserved' end,
			case when i = 1 then 'manual' else 'public_booking' end,
			'Pendiente',
			'Pendiente',
			30
		)
		returning id into v_future_to_cancel_id;
	end loop;

	select public.get_public_booking_active_future_count_by_name(
		v_business_id,
		'  ana   GÓMEZ ',
		statement_timestamp()
	)
	into v_count;
	if v_count <> 4 then
		raise exception 'TEST_NAME_RPC_EXPECTED_4_GOT_%', v_count;
	end if;

	-- Otro nombre conserva un cupo independiente.
	v_start := statement_timestamp() + interval '6 days';
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_bruno_id, v_service_id, v_professional_id,
		v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
		'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
	);

	-- El quinto turno falla aunque vuelva a usarse el otro número/ficha.
	begin
		v_start := statement_timestamp() + interval '7 days';
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id, v_ana_phone_a_id, v_service_id, v_professional_id,
			v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
			'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
		);
		raise exception 'TEST_EXPECTED_ACTIVE_LIMIT';
	exception when others then
		v_limit_error := sqlerrm;
		if v_limit_error <> 'PUBLIC_BOOKING_ACTIVE_LIMIT' then
			raise exception 'TEST_WRONG_LIMIT_ERROR_%', v_limit_error;
		end if;
	end;

	-- Cancelar uno libera el cupo para cualquiera de los teléfonos del nombre.
	update public.appointments
	set status = 'cancelled'
	where id = v_future_to_cancel_id;

	v_start := statement_timestamp() + interval '8 days';
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_ana_phone_b_id, v_service_id, v_professional_id,
		v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
		'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
	);

	select count(*)::integer
	into v_count
	from public.appointments appointment
	join public.patients patient
		on patient.business_id = appointment.business_id
		and patient.id = appointment.patient_id
	where appointment.business_id = v_business_id
		and public.normalized_patient_name(patient.full_name) = 'ana gomez'
		and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
		and appointment.starts_at > statement_timestamp();
	if v_count <> 4 then
		raise exception 'TEST_EXPECTED_FINAL_NAME_TOTAL_4_GOT_%', v_count;
	end if;

	select count(*)::integer
	into v_count
	from public.appointments
	where business_id = v_business_id
		and patient_id = v_ana_phone_a_id
		and starts_at <= statement_timestamp();
	if v_count <> 345 then
		raise exception 'TEST_EXPECTED_345_PAST_GOT_%', v_count;
	end if;

	raise notice 'PASS: two phones share one normalized-name capacity; past=345; active future=4/4; fifth rejected exactly';
end;
$$;

select extensions.pass('public booking patient policy');
select * from extensions.finish();

rollback;
