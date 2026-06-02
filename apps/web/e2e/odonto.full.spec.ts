import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

const readEnvFile = () => {
	let current = process.cwd();
	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			const env: Record<string, string> = {};
			for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
				const index = trimmed.indexOf('=');
				const key = trimmed.slice(0, index).trim();
				let value = trimmed.slice(index + 1).trim();
				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				env[key] = value;
			}
			return env;
		}
		current = path.dirname(current);
	}
	return {};
};

const cleanupRecentHeadlessBookingAttempts = async () => {
	const env = readEnvFile();
	const url = process.env.ODONTO_SUPABASE_URL ?? env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) return;
	const since = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
	const response = await fetch(
		`${url}/rest/v1/public_booking_attempts?action=eq.booking_create&created_at=gte.${since}&user_agent=ilike.*HeadlessChrome*`,
		{
			method: 'DELETE',
			headers: {
				apikey: key,
				authorization: `Bearer ${key}`,
				prefer: 'return=minimal'
			}
		}
	);
	if (!response.ok) {
		throw new Error(`No se pudieron limpiar intentos e2e recientes: ${await response.text()}`);
	}
};

const restEnv = () => {
	const env = readEnvFile();
	const url = process.env.ODONTO_SUPABASE_URL ?? env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY ?? env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY para E2E.');
	return { url, key };
};

const restHeaders = (key: string) => ({
	apikey: key,
	authorization: `Bearer ${key}`,
	'content-type': 'application/json'
});

const restGetSingle = async <T>(path: string): Promise<T> => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${path}`, {
		headers: restHeaders(key)
	});
	if (!response.ok) throw new Error(`GET ${path} falló: ${await response.text()}`);
	const rows = (await response.json()) as T[];
	if (!rows[0]) throw new Error(`GET ${path} no devolvió registros.`);
	return rows[0];
};

const restInsertSingle = async <T>(table: string, row: Record<string, unknown>, select = 'id'): Promise<T> => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${table}?select=${select}`, {
		method: 'POST',
		headers: {
			...restHeaders(key),
			prefer: 'return=representation'
		},
		body: JSON.stringify(row)
	});
	if (!response.ok) throw new Error(`INSERT ${table} falló: ${await response.text()}`);
	const rows = (await response.json()) as T[];
	if (!rows[0]) throw new Error(`INSERT ${table} no devolvió registros.`);
	return rows[0];
};

const restUpsert = async (table: string, row: Record<string, unknown>, onConflict: string) => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
		method: 'POST',
		headers: {
			...restHeaders(key),
			prefer: 'resolution=merge-duplicates,return=minimal'
		},
		body: JSON.stringify(row)
	});
	if (!response.ok) throw new Error(`UPSERT ${table} falló: ${await response.text()}`);
};

const createAuthUser = async (input: { email: string; password: string }) => {
	const { url, key } = restEnv();
	const response = await fetch(`${url}/auth/v1/admin/users`, {
		method: 'POST',
		headers: restHeaders(key),
		body: JSON.stringify({
			email: input.email,
			password: input.password,
			email_confirm: true
		})
	});
	if (!response.ok) throw new Error(`No se pudo crear usuario auth ${input.email}: ${await response.text()}`);
	return (await response.json()) as { id: string; email: string };
};

const createRoleFixtures = async (suffix: string) => {
	const password = `Role-Test-${suffix}-1998!`;
	const users = {
		owner: await createAuthUser({ email: `owner-${suffix}@roles.test`, password }),
		admin: await createAuthUser({ email: `admin-${suffix}@roles.test`, password }),
		reception: await createAuthUser({ email: `recepcion-${suffix}@roles.test`, password }),
		professional: await createAuthUser({ email: `profesional-${suffix}@roles.test`, password })
	};
	const business = await restInsertSingle<{ id: string; slug: string }>(
		'businesses',
		{
			name: `Roles UX ${suffix}`,
			slug: `roles-ux-${suffix}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60),
			industry: 'odontology',
			email: `roles-${suffix}@test.local`,
			is_active: true
		},
		'id,slug'
	);
	await restUpsert('business_subscriptions', {
		business_id: business.id,
		is_permanent: true,
		subscription_status: 'active',
		commercial_access_enabled: true,
		access_note: 'e2e roles fixture'
	}, 'business_id');
	for (const user of Object.values(users)) {
		await restInsertSingle('allowed_emails', { email: user.email, enabled: true }, 'email');
	}
	const now = new Date().toISOString();
	for (const [role, user] of Object.entries(users)) {
		await restInsertSingle(
			'business_users',
			{
				business_id: business.id,
				user_id: user.id,
				role,
				status: 'active',
				accepted_at: now,
				created_at: now,
				updated_at: now
			},
			'id'
		);
	}
	const professional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: `Dra. Rol ${suffix}`,
		specialty: 'Odontología general',
		email: users.professional.email,
		is_active: true,
		is_public: true
	});
	await restInsertSingle('professional_users', {
		business_id: business.id,
		professional_id: professional.id,
		user_id: users.professional.id
	});
	const linkedPatient = await restInsertSingle<{ id: string }>('patients', {
		business_id: business.id,
		owner_id: users.owner.id,
		full_name: `Paciente Vinculado ${suffix}`,
		phone: `1100${suffix.replace(/\D/g, '').slice(-6).padStart(6, '0')}`,
		email: `vinculado-${suffix}@test.local`
	});
	const hiddenPatient = await restInsertSingle<{ id: string }>('patients', {
		business_id: business.id,
		owner_id: users.owner.id,
		full_name: `Paciente Oculto ${suffix}`,
		phone: `1199${suffix.replace(/\D/g, '').slice(-6).padStart(6, '0')}`,
		email: `oculto-${suffix}@test.local`
	});
	await restInsertSingle('patient_clinical_profiles', {
		business_id: business.id,
		patient_id: linkedPatient.id,
		allergies: 'Alergia secreta e2e',
		medication: 'Medicación sensible e2e',
		background: 'Antecedente sensible e2e'
	});
	await restInsertSingle('professional_patient_links', {
		business_id: business.id,
		professional_id: professional.id,
		patient_id: linkedPatient.id,
		source: 'manual',
		is_active: true,
		created_by: users.owner.id
	});
	return { password, users, business, linkedPatient, hiddenPatient };
};

const createPublicBookingFixtures = async (input: {
	slug: string;
	professionalName: string;
	unavailableProfessionalName: string;
	unassignedProfessionalName: string;
	serviceName: string;
	unavailableServiceName: string;
}) => {
	const business = await restGetSingle<{ id: string }>(
		`businesses?slug=eq.${encodeURIComponent(input.slug)}&select=id`
	);

	const professional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.professionalName,
		specialty: 'Odontología preventiva',
		phone: '1122334455',
		email: null,
		is_active: true,
		is_public: true
	});
	const unavailableProfessional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.unavailableProfessionalName,
		specialty: 'Sin agenda cargada',
		is_active: true,
		is_public: true
	});
	const unassignedProfessional = await restInsertSingle<{ id: string }>('professionals', {
		business_id: business.id,
		name: input.unassignedProfessionalName,
		specialty: 'No ofrece el servicio elegido',
		is_active: true,
		is_public: true
	});

	const service = await restInsertSingle<{ id: string }>('services', {
		business_id: business.id,
		name: input.serviceName,
		duration_minutes: 45,
		buffer_before_minutes: 0,
		buffer_after_minutes: 0,
		price_label: '$ 350.000',
		description: null,
		is_active: true,
		is_public: true
	});
	const unavailableService = await restInsertSingle<{ id: string }>('services', {
		business_id: business.id,
		name: input.unavailableServiceName,
		duration_minutes: 30,
		buffer_before_minutes: 0,
		buffer_after_minutes: 0,
		price_label: null,
		description: null,
		is_active: true,
		is_public: true
	});

	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: professional.id,
		service_id: service.id
	}, 'business_id');
	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: unavailableProfessional.id,
		service_id: service.id
	}, 'business_id');
	await restInsertSingle('professional_services', {
		business_id: business.id,
		professional_id: unavailableProfessional.id,
		service_id: unavailableService.id
	}, 'business_id');

	for (const professionalId of [professional.id, unassignedProfessional.id]) {
		for (const weekday of [1, 2, 3, 4, 5]) {
			await restInsertSingle('availability_rules', {
				business_id: business.id,
				professional_id: professionalId,
				weekday,
				start_time: '09:00:00',
				end_time: '10:00:00',
				slot_interval_minutes: 15,
				is_active: true
			});
		}
	}

	return { businessId: business.id, serviceId: service.id, professionalId: professional.id };
};

const login = async (page: import('@playwright/test').Page) => {
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Correo electrónico').fill(email ?? '');
	await page.getByLabel('Contraseña').fill(password ?? '');
	await page.locator('form').getByRole('button', { name: 'Ingresar' }).click();
	await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
};

const loginAs = async (
	page: import('@playwright/test').Page,
	credentials: { email: string; password: string },
	expectedLink: RegExp | string
) => {
	await page.goto('/logout').catch(() => undefined);
	await page.goto('/login');
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Correo electrónico').fill(credentials.email);
	await page.getByLabel('Contraseña').fill(credentials.password);
	await page.locator('form').getByRole('button', { name: 'Ingresar' }).click();
	await expect(navItem(page, expectedLink).first()).toBeVisible();
};

const navItem = (page: import('@playwright/test').Page, name: RegExp | string) =>
	page.getByRole('link', { name }).or(page.getByRole('button', { name }));

const section = (page: import('@playwright/test').Page, text: string) =>
	page.locator('section, div.ux-card').filter({ hasText: text }).first();

const addUserRoleSelect = (page: import('@playwright/test').Page) =>
	page.locator('form').filter({ hasText: 'Agregar usuario' }).locator('select[name="role"]');

const openDayAppointmentsPanel = async (page: import('@playwright/test').Page) => {
	const heading = page.getByRole('heading', { name: /Turnos del día|Resultado de búsqueda/ });
	if (await heading.first().isVisible({ timeout: 1000 }).catch(() => false)) return;
	const button = page.getByRole('button', { name: 'Ver turnos del día' });
	await expect(button).toBeVisible();
	await button.click();
	await expect(heading.first()).toBeVisible();
};

test.describe.configure({ mode: 'serial' });

test.describe('Dental Suite - flujo operativo completo', () => {
	test.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr el flujo completo.');

	test('profesional, servicio, disponibilidad, reserva pública, agenda y protección contra solapamiento', async ({ page }) => {
		test.setTimeout(300_000);

		const suffix = uniqueSuffix();
		const professionalName = `E2E Profesional ${suffix}`;
		const unavailableProfessionalName = `E2E Sin horarios ${suffix}`;
		const unassignedProfessionalName = `E2E No ofrece ${suffix}`;
		const serviceName = `E2E Limpieza ${suffix}`;
		const unavailableServiceName = `E2E Sin disponibilidad ${suffix}`;
		const patientName = `E2E Paciente ${suffix}`;
		const overlapPatient = `E2E Solapado ${suffix}`;
		const patientPhone = `+54911${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`;
		const overlapPhone = `+54911${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`;

		await login(page);

		await expect(page.getByRole('link', { name: 'Recordatorios' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Mensajes' })).toHaveCount(0);
		await expect(page.getByText('Panel del consultorio')).toHaveCount(0);

		await page.goto('/odonto/configuracion/comunicacion');
		const linkText = (await page.locator('p').filter({ hasText: '/reservar/' }).first().textContent())?.trim();
		expect(linkText).toBeTruthy();
		const bookingUrl = new URL(linkText ?? '', page.url());
		const bookingSlug = bookingUrl.pathname.split('/').filter(Boolean).at(-1);
		expect(bookingSlug).toBeTruthy();
		await createPublicBookingFixtures({
			slug: bookingSlug ?? '',
			professionalName,
			unavailableProfessionalName,
			unassignedProfessionalName,
			serviceName,
			unavailableServiceName
		});
		await cleanupRecentHeadlessBookingAttempts();

		await page.goto(bookingUrl.pathname);
		await expect(page.getByRole('heading', { name: '¿Qué necesitás?' })).toBeVisible();
		await expect(page.getByText('recibir mensajes relacionados')).toHaveCount(0);
		await expect(page.getByRole('link', { name: new RegExp(serviceName) })).toBeVisible();
		await expect(page.getByText(unavailableServiceName)).toHaveCount(0);
		await page.getByRole('link', { name: new RegExp(serviceName) }).click();
		const professionalStep = section(page, '¿Con quién?');
		await expect(professionalStep.getByRole('link', { name: new RegExp(professionalName) })).toBeVisible();
		await expect(professionalStep.getByText('Primer horario:')).toBeVisible();
		await expect(professionalStep.getByText(unavailableProfessionalName)).toHaveCount(0);
		await expect(professionalStep.getByText(unassignedProfessionalName)).toHaveCount(0);
		await professionalStep.getByRole('link', { name: new RegExp(professionalName) }).click();
		await section(page, 'Elegí un día').getByRole('link').first().click();
		await section(page, 'Elegí un horario').getByRole('link', { name: '09:00' }).click();

		const selectedBookingUrl = new URL(page.url());
		const selectedDate = selectedBookingUrl.searchParams.get('date') ?? '';
		const serviceId = selectedBookingUrl.searchParams.get('service_id') ?? '';
		const professionalId = selectedBookingUrl.searchParams.get('professional_id') ?? '';
		expect(selectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(serviceId).toBeTruthy();
		expect(professionalId).toBeTruthy();

		await page.getByLabel('Nombre y apellido').fill(patientName);
		await page.getByLabel('Teléfono').fill(patientPhone);
		await page.getByLabel('Correo electrónico (opcional)').fill(`paciente-${suffix}@example.com`);
		await page.getByRole('button', { name: 'Confirmar reserva' }).click();
		await expect(page.getByRole('heading', { name: 'Listo, tu turno quedó reservado' })).toBeVisible();
		await expect(page.getByText('Resumen de la reserva')).toBeVisible();
		await expect(page.getByText(serviceName)).toBeVisible();
		await expect(page.getByText(professionalName)).toBeVisible();
		const publicTokenUrl = page.url();

		await page.goto(selectedBookingUrl.toString());
		await expect(section(page, 'Elegí un horario').getByRole('link', { name: '09:00' })).toHaveCount(0);

		const overlapResult = await page.evaluate(
			async ({ serviceId, professionalId, selectedDate, overlapPatient, overlapPhone }) => {
				const form = new FormData();
				form.set('service_id', serviceId);
				form.set('professional_id', professionalId);
				form.set('date', selectedDate);
				form.set('time', '09:00');
				form.set('patient_name', overlapPatient);
				form.set('patient_phone', overlapPhone);
				const response = await fetch('/odonto/agenda?/create_appointment', {
					method: 'POST',
					body: form,
					credentials: 'include'
				});
				return { status: response.status, text: await response.text() };
			},
			{ serviceId, professionalId, selectedDate, overlapPatient, overlapPhone }
		);
		expect(overlapResult.text).toContain('Ese horario no está disponible');

		await page.goto(`/odonto/agenda?date=${selectedDate}`);
		await page.waitForLoadState('networkidle');
		await openDayAppointmentsPanel(page);
		await expect(page.getByText(patientName)).toBeVisible();
		await expect(page.getByText(overlapPatient)).toHaveCount(0);
		await expect(page.getByText(serviceName)).toBeVisible();
		await expect(page.getByText(professionalName)).toBeVisible();
		await expect(page.getByText('Reserva online').first()).toBeVisible();

		await page.goto(publicTokenUrl);
		await page.getByRole('button', { name: 'Confirmo que voy' }).click();
		await expect(page.getByText('Turno confirmado.')).toBeVisible();
		await page.goto(`/odonto/agenda?date=${selectedDate}&status=confirmed`);
		await page.waitForLoadState('networkidle');
		await openDayAppointmentsPanel(page);
		const confirmedAppointment = page.locator('details, article').filter({ hasText: patientName }).first();
		await expect(confirmedAppointment).toBeVisible();
		await expect(confirmedAppointment.getByText('Confirmado')).toBeVisible();

		await page.goto('/odonto/maestro');
		if (page.url().includes('/odonto/maestro')) {
			const manage = page.getByRole('button', { name: 'Gestionar' }).first();
			if (await manage.isVisible()) {
				await manage.click();
				const amount = page.getByPlaceholder('Monto opcional').first();
				await amount.fill('1250000');
				await expect(amount).toHaveValue('1.250.000');
			}
		}
	});

	test('roles reales: navegación, URL directa y paciente vinculado', async ({ page }) => {
		test.setTimeout(240_000);

		const suffix = uniqueSuffix().replace(/[^a-zA-Z0-9]/g, '').slice(-10);
		const fixture = await createRoleFixtures(suffix);

		await loginAs(
			page,
			{ email: fixture.users.owner.email, password: fixture.password },
			'Configuración'
		);
		await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Profesionales' })).toBeVisible();
		await expect(navItem(page, 'Configuración')).toBeVisible();
		await page.goto('/odonto/configuracion/usuarios');
		await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
		await expect(addUserRoleSelect(page).locator('option', { hasText: 'Dueño' })).toHaveCount(1);

		await loginAs(
			page,
			{ email: fixture.users.admin.email, password: fixture.password },
			'Configuración'
		);
		await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Profesionales' })).toBeVisible();
		await page.goto('/odonto/configuracion/usuarios');
		await expect(addUserRoleSelect(page).locator('option', { hasText: 'Dueño' })).toHaveCount(0);
		await expect(addUserRoleSelect(page).locator('option', { hasText: 'Administrador' })).toHaveCount(0);
		const adminSubscriptionResponse = await page.goto('/odonto/configuracion/suscripcion');
		expect(adminSubscriptionResponse?.status()).toBe(403);
		await expect(page.getByText('No tenés permisos para ver la suscripción.')).toBeVisible();

		await loginAs(
			page,
			{ email: fixture.users.reception.email, password: fixture.password },
			'Agenda'
		);
		await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		await expect(navItem(page, 'Configuración')).toHaveCount(0);
		await expect(navItem(page, 'Profesionales')).toHaveCount(0);
		await page.goto('/odonto/configuracion');
		await expect(page).not.toHaveURL(/\/odonto\/configuracion$/);
		await page.goto(`/odonto/pacientes/${fixture.linkedPatient.id}`);
		await expect(page.getByRole('heading', { name: `Paciente Vinculado ${suffix}` })).toBeVisible();
		await expect(page.getByText('Alergia secreta e2e')).toHaveCount(0);

		await loginAs(
			page,
			{ email: fixture.users.professional.email, password: fixture.password },
			/Mis turnos|Mi perfil/
		);
		await expect(page.getByRole('link', { name: 'Mis turnos' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Mis pacientes' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Mi perfil' })).toBeVisible();
		await expect(navItem(page, 'Configuración')).toHaveCount(0);
		await expect(navItem(page, 'Profesionales')).toHaveCount(0);
		await page.goto('/odonto/configuracion');
		await expect(page).toHaveURL(/\/odonto\/mi-perfil/);
		await page.goto(`/odonto/pacientes/${fixture.linkedPatient.id}`);
		await expect(page.getByRole('heading', { name: `Paciente Vinculado ${suffix}` })).toBeVisible();
		await expect(page.getByText('Alergia secreta e2e').first()).toBeVisible();
		await page.goto(`/odonto/pacientes/${fixture.hiddenPatient.id}`);
		await expect(page.getByText(/No tenés acceso a este paciente|No tienes acceso a este paciente/)).toBeVisible();
	});
});
