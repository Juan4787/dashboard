import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

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

const env = { ...readEnvFile(), ...process.env };
const supabaseUrl = env.ODONTO_SUPABASE_URL;
const serviceRoleKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
const masterEmail = (env.MASTER_EMAIL ?? 'juanpabloaltamira@protonmail.com').trim().toLowerCase();
const isLocalSupabase = Boolean(supabaseUrl?.startsWith('http://127.0.0.1') || supabaseUrl?.startsWith('http://localhost'));
const masterPassword = env.E2E_MASTER_PASSWORD ?? (isLocalSupabase ? 'E2eMasterLocal!2026' : '');
const password = 'E2eAssistance!2026';
const screenshotDir = 'output/playwright';

type Fixture = {
	email: string;
	userId: string;
	businessId: string;
	businessName: string;
	businessSlug: string;
	professionalId: string;
};

let fixture: Fixture | null = null;
let setupError: string | null = null;
let createdMasterUserId: string | null = null;

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

const adminClient = () => {
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

const findAuthUserByEmail = async (admin: SupabaseClient, email: string) => {
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
		if (user) return user;
		if (data.users.length < 1000) return null;
	}
	return null;
};

const createFixture = async (admin: SupabaseClient): Promise<Fixture> => {
	const schemaProbe = await admin.from('account_assistance_grants').select('id').limit(1);
	if (schemaProbe.error) throw schemaProbe.error;

	let master = await findAuthUserByEmail(admin, masterEmail);
	if (!master?.id && isLocalSupabase && masterPassword) {
		const masterResult = await admin.auth.admin.createUser({
			email: masterEmail,
			password: masterPassword,
			email_confirm: true
		});
		if (masterResult.error || !masterResult.data.user?.id) {
			throw masterResult.error ?? new Error('No se creó el usuario maestro local.');
		}
		createdMasterUserId = masterResult.data.user.id;
		master = masterResult.data.user;
	}
	if (!master?.id) throw new Error('MASTER_EMAIL no existe en Auth para activar ayuda.');

	const suffix = unique();
	const email = `e2e-ayuda-${suffix}@example.com`;
	const businessName = `E2E Ayuda ${suffix}`;
	const businessSlug = `e2e-ayuda-${suffix}`;
	const authResult = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id) {
		throw authResult.error ?? new Error('No se creó el usuario owner.');
	}
	const userId = authResult.data.user.id;

	const business = await must(
		admin
				.from('businesses')
				.insert({
					name: businessName,
					slug: businessSlug,
					industry: 'odontology',
					timezone: 'America/Argentina/Buenos_Aires',
					public_booking_enabled: true,
				is_active: true
			})
			.select('id')
			.single()
	);

	await must(admin.from('allowed_emails').upsert({ email, enabled: true }, { onConflict: 'email' }));
	await must(
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: userId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);
	await must(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: true,
				subscription_status: 'active',
				paid_until: null,
				grace_until: null,
				restricted_until: null,
				archived_at: null
			},
				{ onConflict: 'business_id' }
			)
	);

	const professional = await must(
		admin
			.from('professionals')
			.insert({
				business_id: business.id,
				name: `Dra. Ayuda ${suffix}`,
				specialty: 'Odontología general',
				is_public: true,
				is_active: true
			})
			.select('id')
			.single()
	);

	return { email, userId, businessId: business.id, businessName, businessSlug, professionalId: professional.id };
};

const cleanupFixture = async (admin: SupabaseClient, target: Fixture | null) => {
	if (!target) return;
	await admin.from('businesses').delete().eq('id', target.businessId);
	await admin.from('allowed_emails').delete().eq('email', target.email);
	await admin.auth.admin.deleteUser(target.userId);
};

const cleanupMasterFixture = async (admin: SupabaseClient) => {
	if (!createdMasterUserId) return;
	await admin.auth.admin.deleteUser(createdMasterUserId);
	createdMasterUserId = null;
};

const clearLocalLoginRateLimits = async (admin: SupabaseClient) => {
	if (!isLocalSupabase) return;
	await admin
		.from('server_rate_limit_events')
		.delete()
		.in('action', ['login_password_by_email', 'login_password_by_ip'])
		.gte('created_at', '1970-01-01T00:00:00.000Z');
};

const login = async (page: import('@playwright/test').Page, email: string, targetPassword: string) => {
	await page.goto('/login');
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(targetPassword);
	await Promise.all([
		page.waitForURL((url) => !url.pathname.startsWith('/login')),
		page.locator('form').first().getByRole('button', { name: 'Ingresar', exact: true }).click()
	]);
};

const screenshotPath = (name: string) => {
	fs.mkdirSync(screenshotDir, { recursive: true });
	return path.join(screenshotDir, name);
};

test.describe('Ayuda para configurar', () => {
	test.setTimeout(120_000);
	test.skip(!supabaseUrl || !serviceRoleKey, 'Definí ODONTO_SUPABASE_URL y ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	test.skip(!masterPassword, 'Definí E2E_MASTER_PASSWORD para validar el ingreso desde panel maestro.');

	test.beforeAll(async () => {
		try {
			await clearLocalLoginRateLimits(adminClient());
			fixture = await createFixture(adminClient());
		} catch (error) {
			setupError = error instanceof Error ? error.message : String(error);
		}
	});

	test.afterAll(async () => {
		if (!supabaseUrl || !serviceRoleKey) return;
		await cleanupFixture(adminClient(), fixture);
		await cleanupMasterFixture(adminClient());
	});

	test('el dueño activa ayuda, el equipo configura datos operativos y luego pierde acceso al revocar', async ({
		page,
		browser
	}) => {
		test.skip(Boolean(setupError), setupError ?? 'No se pudo preparar el fixture.');
		if (!fixture) throw new Error('Fixture no preparado.');
		const admin = adminClient();
		const ownerPage = page;
		const masterContext = await browser.newContext();
		const masterPage = await masterContext.newPage();

		await login(ownerPage, fixture.email, password);
		await ownerPage.goto('/odonto/configuracion/ayuda');
		await expect(ownerPage.getByRole('heading', { name: 'Ayuda para configurar' })).toBeVisible();
		await ownerPage.getByRole('button', { name: 'Quiero ayuda por 1 hora' }).first().click();
		await expect(ownerPage.getByText('Ayuda de Cita Suite activa').first()).toBeVisible();
		await expect(ownerPage.getByText(/hasta las \d{2}:\d{2}/).first()).toBeVisible();
		await ownerPage.screenshot({
			path: screenshotPath('account-assistance-owner-desktop-active.png'),
			fullPage: false
		});
		await ownerPage.setViewportSize({ width: 390, height: 844 });
		await ownerPage.screenshot({
			path: screenshotPath('account-assistance-owner-mobile-active.png'),
			fullPage: false
		});
		await ownerPage.setViewportSize({ width: 1280, height: 720 });

		const { data: activeRows, error: activeError } = await admin
			.from('account_assistance_grants')
			.select('id, status, expires_at, revoked_at')
			.eq('business_id', fixture.businessId)
			.eq('status', 'active')
			.is('revoked_at', null);
		if (activeError) throw activeError;
		expect(activeRows).toHaveLength(1);
		expect(new Date(activeRows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 45 * 60 * 1000);

		await login(masterPage, masterEmail, masterPassword);
		await expect(masterPage.getByRole('heading', { name: 'Accesos a Cita Suite' })).toBeVisible();
		const assistanceCard = masterPage.locator('.ux-soft-card').filter({ hasText: fixture.businessName });
		await expect(assistanceCard.getByText(`/${fixture.businessSlug}`, { exact: true })).toBeVisible();
		await assistanceCard.getByRole('button', { name: 'Abrir configuración' }).click();
		await expect(masterPage).toHaveURL(/\/odonto\/configuracion\/usuarios/);
		await expect(masterPage.getByText('Configurando esta cuenta').first()).toBeVisible();
		await masterPage.screenshot({
			path: screenshotPath('account-assistance-master-configuring.png'),
			fullPage: false
		});

		const serviceName = `Limpieza E2E ${unique()}`;
		await masterPage.goto(`/odonto/profesionales/${fixture.professionalId}?tab=servicios`);
		await expect(masterPage.getByText('Configurando esta cuenta').first()).toBeVisible();
		const servicePanel = masterPage.locator('.ux-soft-card').filter({ hasText: '¿No encontrás el servicio?' });
		await expect(async () => {
			await servicePanel.getByRole('button', { name: 'Crear servicio nuevo' }).click();
			await expect(servicePanel.getByRole('button', { name: 'Cerrar' })).toBeVisible({ timeout: 1_000 });
		}).toPass({ timeout: 10_000 });
		await servicePanel.getByLabel('Nombre').fill(serviceName);
		await servicePanel.getByLabel('Duración en minutos').fill('35');
		await servicePanel.getByRole('button', { name: 'Crear y asignar' }).click();
		await expect(masterPage.getByText('Servicio creado y asignado.')).toBeVisible();

		const { data: services, error: servicesError } = await admin
			.from('services')
			.select('id, duration_minutes, professional_services!inner(professional_id)')
			.eq('business_id', fixture.businessId)
			.eq('name', serviceName);
		if (servicesError) throw servicesError;
		expect(services).toHaveLength(1);
		expect(services[0].duration_minutes).toBe(35);

		await ownerPage.goto('/odonto/configuracion/ayuda');
		await ownerPage.getByRole('button', { name: 'Detener ayuda' }).first().click();
		await expect(ownerPage.getByRole('heading', { name: 'Ayuda detenida' })).toBeVisible();

		const { data: revoked, error: revokedError } = await admin
			.from('account_assistance_grants')
			.select('status, revoked_at')
			.eq('id', activeRows[0].id)
			.single();
		if (revokedError) throw revokedError;
		expect(revoked.status).toBe('revoked');
		expect(revoked.revoked_at).toBeTruthy();

		await masterPage.goto('/odonto/maestro');
		await expect(masterPage.getByRole('heading', { name: 'Accesos a Cita Suite' })).toBeVisible();
		await expect(masterPage.locator('.ux-soft-card').filter({ hasText: fixture.businessName })).toHaveCount(0);
		await masterPage.goto(`/odonto/profesionales/${fixture.professionalId}?tab=servicios`);
		await expect(masterPage).not.toHaveURL(/\/odonto\/profesionales\//);
		await masterContext.close();
	});
});
