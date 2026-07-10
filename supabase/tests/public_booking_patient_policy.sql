-- Run with:
-- psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/public_booking_patient_policy.sql
--
-- Transactional integration test: leaves no rows behind.

begin;

do $$
declare
	v_business_id uuid;
	v_service_id uuid;
	v_professional_id uuid;
	v_juan_carlos_id uuid;
	v_juan_pablo_id uuid;
	v_other_juan_carlos_id uuid;
	v_first_future_id uuid;
	v_start timestamptz;
	v_count integer;
	v_limit_error text;
	i integer;
begin
	insert into public.businesses (name, slug, industry, timezone)
	values (
		'E2E politica de pacientes',
		'e2e-patient-policy-' || gen_random_uuid()::text,
		'odontology',
		'America/Argentina/Buenos_Aires'
	)
	returning id into v_business_id;

	insert into public.services (
		business_id,
		name,
		duration_minutes,
		buffer_before_minutes,
		buffer_after_minutes
	)
	values (v_business_id, 'Consulta E2E', 30, 0, 0)
	returning id into v_service_id;

	insert into public.professionals (business_id, name)
	values (v_business_id, 'Profesional E2E')
	returning id into v_professional_id;

	insert into public.professional_services (business_id, professional_id, service_id)
	values (v_business_id, v_professional_id, v_service_id);

	-- Compartir primer nombre o incluso el nombre completo no mezcla identidades.
	insert into public.patients (business_id, full_name, phone_e164)
	values (v_business_id, 'Juan Carlos', '+5493510000101')
	returning id into v_juan_carlos_id;

	insert into public.patients (business_id, full_name, phone_e164)
	values (v_business_id, 'Juan Pablo', '+5493510000102')
	returning id into v_juan_pablo_id;

	insert into public.patients (business_id, full_name, phone_e164)
	values (v_business_id, 'Juan Carlos', '+5493510000103')
	returning id into v_other_juan_carlos_id;

	select count(*)::integer
	into v_count
	from public.patients
	where business_id = v_business_id;
	if v_count <> 3 then
		raise exception 'TEST_IDENTITY_EXPECTED_3_PATIENTS_GOT_%', v_count;
	end if;

	-- Un historial arbitrariamente grande no consume cupo si ya quedó atrás.
	for i in 1..345 loop
		v_start := statement_timestamp() - make_interval(days => i);
		insert into public.appointments (
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
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id,
			v_juan_carlos_id,
			v_service_id,
			v_professional_id,
			v_start,
			v_start + interval '30 minutes',
			v_start,
			v_start + interval '30 minutes',
			'confirmed',
			'public_booking',
			'Pendiente',
			'Pendiente',
			30
		);
	end loop;

	-- Los primeros cuatro turnos futuros activos están permitidos. El cupo es
	-- por paciente y cuenta también un turno manual, no sólo reservas públicas.
	for i in 1..4 loop
		v_start := statement_timestamp() + make_interval(days => i);
		insert into public.appointments (
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
			service_name_snapshot,
			professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id,
			v_juan_carlos_id,
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
		returning id into v_first_future_id;
	end loop;

	-- Juan Pablo es otra persona: su turno no usa el cupo de Juan Carlos.
	v_start := statement_timestamp() + interval '6 days';
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_juan_pablo_id, v_service_id, v_professional_id,
		v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
		'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
	);

	-- El quinto futuro activo de la misma ficha debe fallar con el código exacto.
	begin
		v_start := statement_timestamp() + interval '7 days';
		insert into public.appointments (
			business_id, patient_id, service_id, professional_id,
			starts_at, ends_at, blocking_starts_at, blocking_ends_at,
			status, source, service_name_snapshot, professional_name_snapshot,
			duration_minutes_snapshot
		)
		values (
			v_business_id, v_juan_carlos_id, v_service_id, v_professional_id,
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

	-- Al cancelar uno, el cupo vuelve inmediatamente a 3/4 y permite otro.
	update public.appointments
	set status = 'cancelled'
	where id = v_first_future_id;

	v_start := statement_timestamp() + interval '8 days';
	insert into public.appointments (
		business_id, patient_id, service_id, professional_id,
		starts_at, ends_at, blocking_starts_at, blocking_ends_at,
		status, source, service_name_snapshot, professional_name_snapshot,
		duration_minutes_snapshot
	)
	values (
		v_business_id, v_juan_carlos_id, v_service_id, v_professional_id,
		v_start, v_start + interval '30 minutes', v_start, v_start + interval '30 minutes',
		'reserved', 'public_booking', 'Pendiente', 'Pendiente', 30
	);

	select count(*)::integer
	into v_count
	from public.appointments
	where business_id = v_business_id
		and patient_id = v_juan_carlos_id
		and status in ('reserved', 'confirmed', 'reschedule_requested')
		and starts_at > statement_timestamp();
	if v_count <> 4 then
		raise exception 'TEST_EXPECTED_FINAL_4_GOT_%', v_count;
	end if;

	select count(*)::integer
	into v_count
	from public.appointments
	where business_id = v_business_id
		and patient_id = v_juan_carlos_id
		and starts_at <= statement_timestamp();
	if v_count <> 345 then
		raise exception 'TEST_EXPECTED_345_PAST_GOT_%', v_count;
	end if;

	raise notice 'PASS: shared names stay distinct; past=345; active future=4/4; fifth rejected exactly';
end;
$$;

rollback;
