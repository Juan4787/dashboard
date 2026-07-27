import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const allowDestructive = process.env.E2E_ALLOW_DESTRUCTIVE === 'true';
const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const password = 'E2eLocal!2026';

type Fixture = {
	suffix: string;
	ownerEmail: string;
	ownerUserId: string;
	authUserIds: string[];
	businessId: string;
	serviceId: string;
	professionalId: string;
	otherProfessionalId: string;
	patientId: string;
	secondPatientId: string;
	date: string;
};

const e2eDate = () => {
	const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	return value.toISOString().slice(0, 10);
};

const addIsoDays = (date: string, days: number) => {
	const value = new Date(`${date}T12:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
};

const rest = () => {
	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	}
	return createClient(supabaseUrl, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false },
		realtime: { transport: WebSocket }
	});
};

const must = async <T>(operation: PromiseLike<{ data: T; error: unknown }>) => {
	const { data, error } = await operation;
	if (error) throw error;
	return data;
};

const createFixture = async (admin: SupabaseClient): Promise<Fixture> => {
	const suffix = unique();
	const ownerEmail = `e2e-owner-${suffix}@example.com`;
	const businessSlug = `e2e-roles-agenda-${suffix}`;

	const authResult = await admin.auth.admin.createUser({
		email: ownerEmail,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id) throw authResult.error ?? new Error('No se creó usuario owner.');
	const ownerUserId = authResult.data.user.id;

	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Roles Agenda ${suffix}`,
				slug: businessSlug,
				industry: 'odontology',
				timezone: 'America/Argentina/Cordoba',
				public_booking_enabled: true,
				allow_same_day_booking: true,
				min_booking_notice_minutes: 0,
				max_booking_days_ahead: 90,
				is_active: true
			})
			.select('id')
			.single()
	);

	await must(
		admin.from('business_subscriptions').upsert({
			business_id: business.id,
			commercial_access_enabled: true,
			is_permanent: true,
			subscription_status: 'active',
			access_starts_at: new Date().toISOString(),
			paid_until: null,
			grace_until: null,
			restricted_until: null,
			archived_at: null
		}, {
			onConflict: 'business_id'
		})
	);
	await must(
		admin.from('allowed_emails').upsert({
			email: ownerEmail,
			enabled: true
		})
	);
	await must(
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: ownerUserId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);

	const service = await must(
		admin
			.from('services')
			.insert({
				business_id: business.id,
				name: `E2E Consulta ${suffix}`,
				duration_minutes: 45,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				is_active: true,
				is_public: true
			})
			.select('id')
			.single()
	);

	const [professional, otherProfessional] = await Promise.all([
		must(
			admin
				.from('professionals')
				.insert({
					business_id: business.id,
					name: `E2E Profesional Base ${suffix}`,
					email: null,
					is_active: true,
					is_public: true
				})
				.select('id')
				.single()
		),
		must(
			admin
				.from('professionals')
				.insert({
					business_id: business.id,
					name: `E2E Profesional Otro ${suffix}`,
					email: null,
					is_active: true,
					is_public: true
				})
				.select('id')
				.single()
		)
	]);

	for (const professionalId of [professional.id, otherProfessional.id]) {
		await must(
			admin.from('professional_services').insert({
				business_id: business.id,
				professional_id: professionalId,
				service_id: service.id
			})
		);
		for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
			await must(
				admin.from('availability_rules').insert({
					business_id: business.id,
					professional_id: professionalId,
					weekday,
					start_time: '09:00:00',
					end_time: '12:00:00',
					slot_interval_minutes: 15,
					break_minutes: 0,
					is_active: true
				})
			);
		}
	}

	const [patient, secondPatient] = await Promise.all([
		must(
			admin
				.from('patients')
				.insert({
					business_id: business.id,
					owner_id: ownerUserId,
					full_name: `E2E Paciente ${suffix}`,
					phone: `549111${Math.floor(100000 + Math.random() * 899999)}`,
					phone_raw: `+549111${Math.floor(100000 + Math.random() * 899999)}`,
					phone_e164: `+549111${Math.floor(100000 + Math.random() * 899999)}`
				})
				.select('id')
				.single()
		),
		must(
			admin
				.from('patients')
				.insert({
					business_id: business.id,
					owner_id: ownerUserId,
					full_name: `E2E Paciente Dos ${suffix}`,
					phone: `549112${Math.floor(100000 + Math.random() * 899999)}`,
					phone_raw: `+549112${Math.floor(100000 + Math.random() * 899999)}`,
					phone_e164: `+549112${Math.floor(100000 + Math.random() * 899999)}`
				})
				.select('id')
				.single()
		)
	]);

	return {
		suffix,
		ownerEmail,
		ownerUserId,
		authUserIds: [ownerUserId],
		businessId: business.id,
		serviceId: service.id,
		professionalId: professional.id,
		otherProfessionalId: otherProfessional.id,
		patientId: patient.id,
		secondPatientId: secondPatient.id,
		date: e2eDate()
	};
};

const cleanupFixture = async (admin: SupabaseClient, fixture: Partial<Fixture> | null) => {
	if (!fixture) return;
	const operations: Array<PromiseLike<{ error: unknown }>> = [];
	if (fixture.businessId) operations.push(admin.from('businesses').delete().eq('id', fixture.businessId));
	if (fixture.ownerEmail) operations.push(admin.from('allowed_emails').delete().eq('email', fixture.ownerEmail));
	if (fixture.suffix) {
		operations.push(admin.from('allowed_emails').delete().like('email', `e2e-prof-${fixture.suffix}%@example.com`));
	}

	for (const operation of operations) {
		const { error } = await operation;
		if (error) throw error;
	}
	const authUserIds = new Set<string>([
		...(fixture.authUserIds ?? []),
		...(fixture.ownerUserId ? [fixture.ownerUserId] : [])
	]);
	for (const userId of authUserIds) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error && !String((error as { message?: string }).message ?? '').includes('User not found')) {
			throw error;
		}
	}
};

const login = async (page: Page, fixture: Fixture) => {
	await page.goto('/login');
	await page.getByLabel('Correo electrónico').fill(fixture.ownerEmail);
	await page.getByLabel('Contraseña').fill(password);
	await page.locator('form').getByRole('button', { name: 'Ingresar', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
};

const postAction = async (
	page: Page,
	url: string,
	fields: Record<string, string | string[]>
): Promise<{ status: number; text: string; url: string }> =>
	page.evaluate(
		async ({ url, fields }) => {
			const form = new FormData();
			for (const [key, value] of Object.entries(fields)) {
				if (Array.isArray(value)) {
					for (const item of value) form.append(key, item);
				} else {
					form.set(key, value);
				}
			}
			const response = await fetch(url, {
				method: 'POST',
				body: form,
				credentials: 'include'
			});
			return { status: response.status, text: await response.text(), url: response.url };
		},
		{ url, fields }
	);

const openDayAppointmentsPanel = async (page: Page) => {
	const heading = page.getByRole('heading', { name: /Turnos del día|Resultado de búsqueda/ });
	if (await heading.first().isVisible({ timeout: 1000 }).catch(() => false)) return;
	const button = page.getByRole('button', { name: 'Ver turnos del día' });
	await expect(button).toBeVisible();
	await button.click();
	await expect(heading.first()).toBeVisible();
};

const openReprogramPanel = async (page: Page) => {
	const panel = page.locator('details#reprogramar');
	const isOpen = await panel.evaluate((node) => (node as HTMLDetailsElement).open).catch(() => false);
	if (!isOpen) await panel.locator('summary').click();
	await expect(panel.getByRole('heading', { name: 'Reprogramar' })).toBeVisible();
	return panel;
};

const ensureCategoryOpen = async (page: Page, name: RegExp) => {
	const button = page.getByRole('button', { name });
	await expect(button).toBeVisible();
	if ((await button.getAttribute('aria-expanded')) === 'true') return;
	await expect(async () => {
		await button.click();
		await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
	}).toPass({ timeout: 10_000 });
};

test.describe('roles, profesionales y agenda - regresiones críticas', () => {
	test.skip(!allowDestructive || !supabaseUrl || !serviceRoleKey, 'Requiere E2E_ALLOW_DESTRUCTIVE=true y ODONTO_SUPABASE_* local/staging.');

	let admin: SupabaseClient;
	let fixture: Fixture | null = null;

	test.beforeAll(async () => {
		admin = rest();
		fixture = await createFixture(admin);
	});

	test.afterAll(async () => {
		await cleanupFixture(admin, fixture);
	});

	test('crea rol profesional pendiente sin duplicar perfiles y mantiene agenda coherente', async ({ page, browser }) => {
		test.setTimeout(240_000);
		if (!fixture) throw new Error('Fixture no inicializado.');
		await login(page, fixture);

		const pendingProfessionalEmail = `e2e-prof-${fixture.suffix}@example.com`;
		const pendingProfessionalName = `E2E Profesional Nuevo ${fixture.suffix}`;

		await page.goto('/odonto/configuracion/usuarios');
		await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible();

		const addMemberButton = page.getByRole('button', { name: 'Agregar integrante' });
		await expect(async () => {
			await addMemberButton.click();
			await expect(page.getByRole('heading', { name: 'Agregar integrante' })).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await page.getByLabel('Email').fill(pendingProfessionalEmail);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByRole('button', { name: 'Profesional Atiende turnos y accede a sus pacientes.' }).click();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await page.getByPlaceholder('Nombre y apellido').fill(pendingProfessionalName);
		await page.getByRole('button', { name: 'Siguiente' }).click();
		// Paso Servicios: Consulta y Otro servicio vienen incluidos.
		await expect(page.getByText('Servicios que ofrece')).toBeVisible();
		await expect(page.getByText('Consulta', { exact: true })).toBeVisible();
		await expect(page.getByText('Otro servicio', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Siguiente' }).click();
		// Paso Horarios: obligatorio.
		await page.getByRole('button', { name: 'Lunes a viernes' }).click();
		await page.getByPlaceholder('9 a 13, 15 a 19').fill('9 a 12');
		await page.getByRole('button', { name: 'Siguiente' }).click();
		await expect(page.getByText('Servicios incluidos')).toBeVisible();
		await page.getByRole('button', { name: 'Guardar rol' }).click();
		await expect(page.getByText('Profesional creado y email habilitado.')).toBeVisible();

		await ensureCategoryOpen(page, /^Profesionales/);
		await expect(page.getByText(pendingProfessionalEmail)).toBeVisible();
		await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Ver profesional' })).toBeVisible();

		const { data: pendingInvite } = await admin
			.from('business_user_invites')
			.select('id, professional_id, role, status')
			.eq('business_id', fixture.businessId)
			.eq('email', pendingProfessionalEmail)
			.single();
		expect(pendingInvite?.role).toBe('professional');
		expect(pendingInvite?.status).toBe('pending');
		expect(pendingInvite?.professional_id).toBeTruthy();

		const pendingContext = await browser.newContext();
		const pendingPage = await pendingContext.newPage();
		await pendingPage.goto('/login');
		await pendingPage.waitForLoadState('networkidle');
		await pendingPage.locator('.mb-6').getByRole('button', { name: 'Crear cuenta' }).click();
		await expect(
			pendingPage.locator('form').getByRole('button', { name: 'Crear cuenta', exact: true })
		).toBeVisible();
		await pendingPage.getByLabel('Correo electrónico').fill(pendingProfessionalEmail);
		await pendingPage.locator('input[name="password"]').fill(password);
		await pendingPage.locator('input[name="confirm_password"]').fill(password);
		await pendingPage.getByLabel(/Leí y acepto/).check();
		await pendingPage.locator('form').getByRole('button', { name: 'Crear cuenta', exact: true }).click();
		await expect(pendingPage).toHaveURL(/\/odonto\/mis-turnos/);
		await expect(pendingPage.getByRole('link', { name: 'Mis turnos' })).toBeVisible();
		await expect(pendingPage.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		await pendingContext.close();
		// Restablece explícitamente la sesión dueña antes de continuar con las
		// verificaciones administrativas; evita que una implementación de auth o
		// un navegador compartido contamine la segunda mitad del flujo.
		await page.context().clearCookies();
		await login(page, fixture);

		const { data: acceptedInvite } = await admin
			.from('business_user_invites')
			.select('status, accepted_user_id, professional_id')
			.eq('business_id', fixture.businessId)
			.eq('email', pendingProfessionalEmail)
			.single();
		expect(acceptedInvite?.status).toBe('accepted');
		expect(acceptedInvite?.accepted_user_id).toBeTruthy();
		if (acceptedInvite?.accepted_user_id) fixture.authUserIds.push(String(acceptedInvite.accepted_user_id));

		const { data: acceptedMembership } = await admin
			.from('business_users')
			.select('role, status, accepted_at')
			.eq('business_id', fixture.businessId)
			.eq('user_id', acceptedInvite?.accepted_user_id)
			.single();
		expect(acceptedMembership?.role).toBe('professional');
		expect(acceptedMembership?.status).toBe('active');
		expect(acceptedMembership?.accepted_at).toBeTruthy();

		const { data: acceptedProfessionalLink } = await admin
			.from('professional_users')
			.select('id')
			.eq('business_id', fixture.businessId)
			.eq('professional_id', acceptedInvite?.professional_id)
			.eq('user_id', acceptedInvite?.accepted_user_id)
			.single();
		expect(acceptedProfessionalLink?.id).toBeTruthy();

		// La vista vieja de Profesionales redirige a Equipo.
		await page.goto('/odonto/profesionales');
		await page.waitForURL(/\/odonto\/configuracion\/usuarios/);

		// No se puede duplicar un profesional con el mismo email.
		const duplicateAttempt = await postAction(page, '/odonto/configuracion/usuarios?/add_user', {
			email: pendingProfessionalEmail.toUpperCase(),
			role: 'professional',
			professional_name: `E2E Duplicado ${fixture.suffix}`,
			weekdays: '1',
			time_ranges: '9 a 12',
			slot_interval_minutes: '15'
		});
		expect(duplicateAttempt.text).toContain('ya está asignado al rol Profesional');

		const createOtherProfessionalAppointment = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.otherProfessionalId,
			date: fixture.date,
			time: '10:30',
			patient_id: fixture.secondPatientId
		});
		expect(createOtherProfessionalAppointment.status).toBeLessThan(500);

		const createAppointment = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.professionalId,
			date: fixture.date,
			time: '09:00',
			patient_id: fixture.patientId
		});
		expect(createAppointment.status).toBeLessThan(500);

		const { data: appointment } = await admin
			.from('appointments')
			.select('id, status, source, confirmed_at')
			.eq('business_id', fixture.businessId)
			.eq('patient_id', fixture.patientId)
			.eq('professional_id', fixture.professionalId)
			.single();
		expect(appointment?.status).toBe('reserved');
		expect(appointment?.source).toBe('manual');
		expect(appointment?.confirmed_at).toBeNull();

		await page.goto(`/odonto/agenda?date=${fixture.date}`);
		await openDayAppointmentsPanel(page);
		await expect(page.getByText('Reservado').first()).toBeVisible();
		await expect(page.getByText('Confirmado')).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Ver turnos de la semana' })).toBeVisible();

		await page.goto(`/odonto/agenda/semana?date=${fixture.date}`);
		await expect(page.getByRole('button', { name: 'Buscar' })).toBeVisible();
		await expect(page.getByText('Reservados:')).toBeVisible();

		await page.goto(`/odonto/turnos/${appointment?.id}?from_date=${fixture.date}`);
		await expect(page.getByRole('link', { name: 'Volver' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmar' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Marcar asistió' })).toBeVisible();

		const confirmAttempt = await postAction(page, `/odonto/turnos/${appointment?.id}?/update_status`, {
			status: 'confirmed'
		});
		expect(confirmAttempt.text).toContain('La confirmación queda reservada al paciente');

		await admin.from('audit_logs').insert([
			{
				business_id: fixture.businessId,
				user_id: null,
				action: 'appointment.public_created',
				entity_type: 'appointment',
				entity_id: appointment?.id,
				metadata: {}
			},
			{
				business_id: fixture.businessId,
				user_id: null,
				action: 'appointment.public_confirmed',
				entity_type: 'appointment',
				entity_id: appointment?.id,
				metadata: { from_status: 'reserved', to_status: 'confirmed' }
			}
		]);
		await page.reload();
		await page.getByText('Historial').click();
		await expect(page.getByText('El paciente confirmó el turno desde el enlace')).toBeVisible();
		await expect(page.getByText('appointment.public_confirmed')).toHaveCount(0);

		const reprogramPanel = await openReprogramPanel(page);
		await expect(reprogramPanel.locator('input[type="hidden"][name="reprogram_date"]')).toHaveValue(fixture.date);
		await expect(reprogramPanel.getByRole('button', { name: '10:30' })).toHaveCount(1);

		const createSameProfessionalBlock = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.professionalId,
			date: fixture.date,
			time: '10:30',
			patient_name: `E2E Bloqueo ${fixture.suffix}`,
			patient_phone: `+549113${Math.floor(100000 + Math.random() * 899999)}`
		});
		expect(createSameProfessionalBlock.status).toBeLessThan(500);

		await page.goto(`/odonto/turnos/${appointment?.id}?from_date=${fixture.date}&reprogram_date=${fixture.date}`);
		const reprogramPanelAfterBlock = await openReprogramPanel(page);
		await expect(reprogramPanelAfterBlock.getByRole('button', { name: '10:30' })).toHaveCount(0);

		// Turno conjunto desde la interfaz: el primer horario común es 09:45,
		// justo cuando queda libre el último profesional requerido.
		await page.goto(`/odonto/agenda?date=${fixture.date}`);
		await expect(page).toHaveURL(/\/odonto\/agenda\?date=/);
		await page.waitForLoadState('networkidle');
		const openCreateButton = page.getByRole('button', { name: '+ Nuevo turno', exact: true });
		await expect(async () => {
			if (await openCreateButton.isVisible().catch(() => false)) await openCreateButton.click();
			await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible({
				timeout: 1500
			});
		}).toPass({ timeout: 10_000 });
		const wizardHeading = page.getByRole('heading', {
			name: '¿Qué necesita el paciente?',
			exact: true
		});
		const wizard = page.locator('form').filter({
			has: page.locator('input[name="booking_mode"]')
		});
		await expect(wizard).toBeVisible();
		await expect(wizardHeading).toBeVisible();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Consulta ${fixture.suffix}` })
			.click();
		await wizard.getByRole('button', { name: 'Equipo de profesionales', exact: true }).click();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Profesional Base ${fixture.suffix}` })
			.click();
		await wizard
			.getByRole('button')
			.filter({ hasText: `E2E Profesional Otro ${fixture.suffix}` })
			.click();
		const commonSlotsButton = wizard.getByRole('button', {
			name: 'Ver horarios de 2 profesionales',
			exact: true
		});
		await expect(commonSlotsButton).toBeEnabled({ timeout: 15_000 });
		await commonSlotsButton.click();
		await expect(wizard.getByText('Equipo seleccionado', { exact: true })).toBeVisible();
		await wizard.getByRole('button', { name: '09:45', exact: true }).first().click();
		await wizard.getByRole('button', { name: 'Buscar paciente', exact: true }).click();
		await wizard.getByText(`E2E Paciente ${fixture.suffix}`, { exact: true }).click();
		await Promise.all([
			page.waitForURL(/\/odonto\/turnos\/[0-9a-f-]+/),
			wizard.getByRole('button', { name: 'Crear turno conjunto', exact: true }).click()
		]);

		const jointId = page.url().match(/\/odonto\/turnos\/([0-9a-f-]+)/)?.[1];
		if (!jointId) throw new Error('La interfaz no abrió el detalle del turno conjunto creado.');
		await expect(page.getByText('Turno conjunto · 2 profesionales', { exact: true })).toBeVisible();
		await expect(page.getByText(`E2E Profesional Base ${fixture.suffix}`, { exact: true })).toBeVisible();
		await expect(page.getByText(`E2E Profesional Otro ${fixture.suffix}`, { exact: true })).toBeVisible();

		const { data: jointAppointment, error: jointAppointmentError } = await admin
			.from('appointments')
			.select('id, professional_name_snapshot, starts_at, ends_at')
			.eq('business_id', fixture.businessId)
			.eq('id', jointId)
			.single();
		if (jointAppointmentError) throw jointAppointmentError;
		expect(jointAppointment.professional_name_snapshot).toContain(
			`E2E Profesional Base ${fixture.suffix}`
		);
		expect(jointAppointment.professional_name_snapshot).toContain(
			`E2E Profesional Otro ${fixture.suffix}`
		);

		const { data: jointAllocations, error: jointAllocationsError } = await admin
			.from('appointment_professionals')
			.select('professional_id, starts_at, ends_at')
			.eq('business_id', fixture.businessId)
			.eq('appointment_id', jointId)
			.order('position');
		if (jointAllocationsError) throw jointAllocationsError;
		const jointTeam = jointAllocations ?? [];
		expect(jointTeam).toHaveLength(2);
		expect(jointTeam.map((allocation) => allocation.professional_id)).toEqual([
			fixture.professionalId,
			fixture.otherProfessionalId
		]);

		const overlapAttempt = await postAction(page, '/odonto/agenda?/create_appointment', {
			service_id: fixture.serviceId,
			professional_id: fixture.otherProfessionalId,
			date: fixture.date,
			time: '09:45',
			patient_id: fixture.secondPatientId
		});
		expect(overlapAttempt.text).toContain(
			'Ese horario ya no está libre para el profesional seleccionado'
		);

		// La reprogramación vuelve a calcular el equipo completo y mueve las dos
		// asignaciones en una sola operación.
		const jointNextDate = addIsoDays(fixture.date, 1);
		const jointNextStart = `${jointNextDate}T12:00:00.000Z`; // 09:00 en Córdoba.
		const jointReschedule = await postAction(
			page,
			`/odonto/turnos/${jointId}?/reschedule`,
			{
				slot_starts_at: jointNextStart,
				reprogram_date: jointNextDate,
				ignore_break: 'false'
			}
		);
		expect(jointReschedule.status).toBeLessThan(500);

		const { data: movedAllocations, error: movedAllocationsError } = await admin
			.from('appointment_professionals')
			.select('professional_id, starts_at')
			.eq('business_id', fixture.businessId)
			.eq('appointment_id', jointId)
			.order('position');
		if (movedAllocationsError) throw movedAllocationsError;
		const movedTeam = movedAllocations ?? [];
		expect(movedTeam).toHaveLength(2);
		expect(
			movedTeam.every(
				(allocation) => new Date(allocation.starts_at).toISOString() === jointNextStart
			)
		).toBe(true);

		// El campo de descanso acepta un entero arbitrario y conserva la grilla
		// interna. Se prueba por UI y luego directamente en las reglas guardadas.
		await page.goto(`/odonto/profesionales/${fixture.professionalId}?tab=horarios`);
		await page.waitForLoadState('networkidle');
		const scheduleForm = page.locator('form[action="?/save_weekly_rules"]');
		const breakInput = scheduleForm.locator('input[type="number"]').first();
		await expect(breakInput).toHaveValue('0');
		await breakInput.fill('23');
		const saveScheduleButton = scheduleForm.getByRole('button', {
			name: 'Guardar sólo horarios',
			exact: true
		});
		await expect(saveScheduleButton).toBeEnabled({ timeout: 5_000 });
		await saveScheduleButton.click();
		await expect(page.getByText('Horarios guardados.', { exact: true })).toBeVisible();

		const { data: savedRules, error: savedRulesError } = await admin
			.from('availability_rules')
			.select('slot_interval_minutes, break_minutes')
			.eq('business_id', fixture.businessId)
			.eq('professional_id', fixture.professionalId);
		if (savedRulesError) throw savedRulesError;
		const storedRules = savedRules ?? [];
		expect(storedRules.length).toBeGreaterThan(0);
		expect(storedRules.every((rule) => rule.break_minutes === 23)).toBe(true);
		expect(storedRules.every((rule) => rule.slot_interval_minutes === 15)).toBe(true);
	});
});
