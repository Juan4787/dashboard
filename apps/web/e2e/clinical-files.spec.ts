import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
const isLocalSupabase = Boolean(
	supabaseUrl?.startsWith('http://127.0.0.1') || supabaseUrl?.startsWith('http://localhost')
);
const password = 'E2eClinicalFiles!2026';
const onePixelPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3pGQAAAAASUVORK5CYII=',
	'base64'
);

type Fixture = {
	ownerEmail: string;
	ownerUserId: string;
	professionalEmail: string;
	professionalUserId: string;
	receptionEmail: string;
	receptionUserId: string;
	businessId: string;
	patientId: string;
	patientName: string;
	hiddenPatientName: string;
	archivedPatientName: string;
};

let fixture: Fixture | null = null;

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan credenciales Supabase locales.');
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
	const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
	const ownerEmail = `e2e-clinical-owner-${suffix}@example.com`;
	const professionalEmail = `e2e-clinical-professional-${suffix}@example.com`;
	const receptionEmail = `e2e-clinical-reception-${suffix}@example.com`;
	const patientName = `Paciente archivos ${suffix}`;
	const hiddenPatientName = `Único lejano ${suffix}`;
	const archivedPatientName = `Paciente archivado ${suffix}`;

	const ownerAuth = await admin.auth.admin.createUser({
		email: ownerEmail,
		password,
		email_confirm: true
	});
	if (ownerAuth.error || !ownerAuth.data.user?.id) {
		throw ownerAuth.error ?? new Error('No se creó el dueño E2E.');
	}
	const ownerUserId = ownerAuth.data.user.id;

	const professionalAuth = await admin.auth.admin.createUser({
		email: professionalEmail,
		password,
		email_confirm: true
	});
	if (professionalAuth.error || !professionalAuth.data.user?.id) {
		await admin.auth.admin.deleteUser(ownerUserId);
		throw professionalAuth.error ?? new Error('No se creó el profesional E2E.');
	}
	const professionalUserId = professionalAuth.data.user.id;
	const receptionAuth = await admin.auth.admin.createUser({
		email: receptionEmail,
		password,
		email_confirm: true
	});
	if (receptionAuth.error || !receptionAuth.data.user?.id) {
		await admin.auth.admin.deleteUser(ownerUserId);
		await admin.auth.admin.deleteUser(professionalUserId);
		throw receptionAuth.error ?? new Error('No se creó la recepción E2E.');
	}
	const receptionUserId = receptionAuth.data.user.id;

	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Archivos clínicos ${suffix}`,
				slug: `e2e-clinical-files-${suffix}`,
				industry: 'odontology',
				timezone: 'America/Argentina/Buenos_Aires',
				is_active: true
			})
			.select('id')
			.single()
	);

	await must(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: true,
				subscription_status: 'active',
				access_starts_at: new Date().toISOString(),
				paid_until: null,
				grace_until: null,
				restricted_until: null,
				archived_at: null
			},
			{ onConflict: 'business_id' }
		)
	);
	await must(
		admin.from('allowed_emails').upsert(
			[
				{ email: ownerEmail, enabled: true },
				{ email: professionalEmail, enabled: true },
				{ email: receptionEmail, enabled: true }
			],
			{ onConflict: 'email' }
		)
	);
	await must(
		admin.from('business_users').insert([
			{
				business_id: business.id,
				user_id: ownerUserId,
				role: 'owner',
				status: 'active',
				accepted_at: new Date().toISOString()
			},
			{
				business_id: business.id,
				user_id: professionalUserId,
				role: 'professional',
				status: 'active',
				accepted_at: new Date().toISOString()
			},
			{
				business_id: business.id,
				user_id: receptionUserId,
				role: 'reception',
				status: 'active',
				accepted_at: new Date().toISOString()
			}
		])
	);

	const professional = await must(
		admin
			.from('professionals')
			.insert({
				business_id: business.id,
				name: `Profesional archivos ${suffix}`,
				email: professionalEmail,
				is_active: true,
				is_public: true
			})
			.select('id')
			.single()
	);
	await must(
		admin.from('professional_users').insert({
			business_id: business.id,
			professional_id: professional.id,
			user_id: professionalUserId
		})
	);

	const patient = await must(
		admin
			.from('patients')
			.insert({
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: patientName,
				dni: `9${String(Date.now()).slice(-7)}`
			})
			.select('id')
			.single()
	);
	await must(
		admin.from('professional_patient_links').insert({
			business_id: business.id,
			professional_id: professional.id,
			patient_id: patient.id,
			source: 'manual',
			is_active: true,
			created_by: ownerUserId
		})
	);

	const activityBase = Date.now() - 60_000;
	await must(
		admin.from('patients').insert([
			...Array.from({ length: 30 }, (_, index) => ({
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: `Paciente paginado ${String(index + 1).padStart(2, '0')} ${suffix}`,
				activity_at: new Date(activityBase - index * 60_000).toISOString()
			})),
			{
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: hiddenPatientName,
				activity_at: new Date('2020-01-01T12:00:00.000Z').toISOString()
			},
			{
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: archivedPatientName,
				activity_at: new Date('2019-01-01T12:00:00.000Z').toISOString(),
				archived_at: new Date().toISOString()
			}
		])
	);

	return {
		ownerEmail,
		ownerUserId,
		professionalEmail,
		professionalUserId,
		receptionEmail,
		receptionUserId,
		businessId: business.id,
		patientId: patient.id,
		patientName,
		hiddenPatientName,
		archivedPatientName
	};
};

const cleanupFixture = async (admin: SupabaseClient, target: Fixture | null) => {
	if (!target) return;
	const { data: radiographs } = await admin
		.from('patient_radiographs')
		.select('storage_bucket, storage_path, thumbnail_path')
		.eq('business_id', target.businessId)
		.eq('storage_provider', 'supabase_storage');
	for (const row of radiographs ?? []) {
		const paths = [row.storage_path, row.thumbnail_path].filter((path): path is string => Boolean(path));
		if (row.storage_bucket && paths.length > 0) {
			const { error } = await admin.storage.from(row.storage_bucket).remove(paths);
			if (error) throw error;
		}
	}
	await must(admin.from('patient_radiographs').delete().eq('business_id', target.businessId));
	await must(admin.from('businesses').delete().eq('id', target.businessId));
	await must(admin
		.from('allowed_emails')
		.delete()
		.in('email', [target.ownerEmail, target.professionalEmail]));
	await must(admin.from('allowed_emails').delete().eq('email', target.receptionEmail));
	for (const userId of [target.ownerUserId, target.professionalUserId, target.receptionUserId]) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
};

const login = async (page: Page, email: string) => {
	await page.goto('/login');
	await page.getByLabel('Correo electrónico').fill(email);
	await page.getByLabel('Contraseña').fill(password);
	await Promise.all([
		page.waitForURL((url) => !url.pathname.startsWith('/login')),
		page.locator('form').first().getByRole('button', { name: 'Ingresar', exact: true }).click()
	]);
};

test.describe('Archivos clínicos privados', () => {
	test.setTimeout(120_000);
	test.skip(
		!isLocalSupabase || !serviceRoleKey,
		'Requiere ODONTO_SUPABASE_URL y ODONTO_SUPABASE_SERVICE_ROLE_KEY de Supabase local.'
	);

	test.beforeAll(async () => {
		const admin = adminClient();
		// Cada corrida usa correos únicos y permanece debajo del límite por IP.
		// La tabla de rate limits es deliberadamente inaccesible incluso al cliente
		// service_role; el E2E debe respetar ese contrato en vez de vaciarla.
		fixture = await createFixture(admin);
	});

	test.afterAll(async () => {
		if (!supabaseUrl || !serviceRoleKey) return;
		await cleanupFixture(adminClient(), fixture);
	});

	test('el dueño carga, el profesional vinculado ve y el dueño restaura desde papelera', async ({
		page,
		browser
	}) => {
		if (!fixture) throw new Error('Fixture no preparado.');
		const description = 'Panorámica compartida del equipo';
		const filename = 'panoramica-equipo.png';
		const professionalDescription = 'Aporte clínico del profesional';
		const professionalFilename = 'aporte-profesional.png';

		await login(page, fixture.ownerEmail);
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: 'Imágenes y radiografías' })).toBeVisible();
		await expect(page.getByText('Todavía no hay imágenes en esta ficha')).toBeVisible();
		await page.locator('input[type="file"]:not([capture])').setInputFiles({
			name: filename,
			mimeType: 'image/png',
			buffer: onePixelPng
		});
		await expect(page.getByRole('heading', { name: 'Añadir imagen clínica' })).toBeVisible();
		const businessToday = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/Argentina/Buenos_Aires',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
		await expect(page.getByLabel('Fecha de toma (opcional)')).toHaveAttribute(
			'max',
			businessToday
		);
		await page.getByLabel('Descripción (opcional)').fill(description);
		await page.getByRole('button', { name: 'Guardar imagen' }).click();
		await expect(page.getByText('Imagen guardada en la ficha del paciente.')).toBeVisible({
			timeout: 30_000
		});
		await expect(page.getByRole('heading', { name: description })).toBeVisible();

		await page.getByRole('button', { name: 'Ver imagen' }).click();
		const ownerViewer = page.getByRole('img', { name: description });
		await expect(ownerViewer).toBeVisible();
		expect(await ownerViewer.getAttribute('src')).toContain(
			'/storage/v1/object/sign/patient-clinical-files/'
		);
		await expect.poll(() => ownerViewer.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
		await page.getByLabel('Cerrar modal').last().getByRole('button', { name: 'Cerrar' }).click();

		const professionalContext = await browser.newContext();
		const professionalPage = await professionalContext.newPage();
		await login(professionalPage, fixture.professionalEmail);
		await professionalPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(professionalPage.getByRole('heading', { name: description })).toBeVisible();
		await expect(professionalPage.getByRole('button', { name: 'Añadir imagen' })).toBeVisible();
		await expect(professionalPage.getByRole('button', { name: 'Mover a papelera' })).toHaveCount(0);
		await professionalPage.getByRole('button', { name: 'Ver imagen' }).click();
		const professionalViewer = professionalPage.getByRole('img', { name: description });
		await expect(professionalViewer).toBeVisible();
		expect(await professionalViewer.getAttribute('src')).toContain(
			'/storage/v1/object/sign/patient-clinical-files/'
		);
		await expect
			.poll(() => professionalViewer.evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBe(1);
		await professionalPage
			.getByLabel('Cerrar modal')
			.last()
			.getByRole('button', { name: 'Cerrar' })
			.click();
		await professionalPage.locator('input[type="file"]:not([capture])').setInputFiles({
			name: professionalFilename,
			mimeType: 'image/png',
			buffer: onePixelPng
		});
		await professionalPage.getByLabel('Descripción (opcional)').fill(professionalDescription);
		await professionalPage.getByRole('button', { name: 'Guardar imagen' }).click();
		await expect(
			professionalPage.getByText('Imagen guardada en la ficha del paciente.')
		).toBeVisible({ timeout: 30_000 });
		await expect(
			professionalPage.getByRole('heading', { name: professionalDescription })
		).toBeVisible();
		await professionalContext.close();

		await page.reload();
		await expect(page.getByRole('heading', { name: professionalDescription })).toBeVisible();
		const ownerFileCard = page.locator('article').filter({
			has: page.getByRole('heading', { name: description })
		});
		await ownerFileCard.getByRole('button', { name: 'Mover a papelera' }).click();
		await expect(page.getByRole('heading', { name: 'Mover imagen a la papelera' })).toBeVisible();
		await page.getByRole('button', { name: 'Mover a papelera' }).last().click();
		await expect(page.getByText('Imagen movida a la papelera. Podés restaurarla cuando la necesites.')).toBeVisible();

		await page.goto('/odonto/pacientes/papelera');
		await expect(page.getByRole('heading', { name: 'Papelera de imágenes' })).toBeVisible();
		await expect(page.getByText(fixture.patientName)).toBeVisible();
		await expect(page.getByText(filename)).toBeVisible();

		const admin = adminClient();
		await must(
			admin
				.from('business_subscriptions')
				.update({
					commercial_access_enabled: true,
					is_permanent: false,
					subscription_status: 'restricted',
					paid_until: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
					grace_until: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
					restricted_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
					archived_at: null
				})
				.eq('business_id', fixture.businessId)
		);
		await page.reload();
		await expect(page.getByText(fixture.patientName)).toBeVisible();
		await expect(page.getByText(filename)).toBeVisible();
		await expect(
			page.getByText(
				'Podés consultar la papelera. Para restaurar imágenes, activá nuevamente la suscripción.'
			)
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restaurar' })).toHaveCount(0);

		await must(
			admin
				.from('business_subscriptions')
				.update({
					commercial_access_enabled: true,
					is_permanent: true,
					subscription_status: 'active',
					paid_until: null,
					grace_until: null,
					restricted_until: null,
					archived_at: null
				})
				.eq('business_id', fixture.businessId)
		);
		await page.reload();
		await page.getByRole('button', { name: 'Restaurar' }).click();
		await page.getByRole('button', { name: 'Restaurar imagen' }).click();
		await expect(page.getByText('Imagen restaurada en la ficha del paciente.')).toBeVisible();

		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: description })).toBeVisible();

		const stored = await must(
			admin
				.from('patient_radiographs')
				.select('status, storage_provider, integrity_status, uploaded_by, deleted_at, restored_by')
					.eq('business_id', fixture.businessId)
					.eq('patient_id', fixture.patientId)
					.eq('uploaded_by', fixture.ownerUserId)
					.single()
		);
		expect(stored).toMatchObject({
			status: 'ready',
			storage_provider: 'supabase_storage',
			integrity_status: 'ok',
			uploaded_by: fixture.ownerUserId,
			deleted_at: null,
			restored_by: fixture.ownerUserId
		});
		const audit = await must(
			admin
				.from('audit_logs')
				.select('action, result')
				.eq('business_id', fixture.businessId)
				.in('action', [
					'radiograph.upload_started',
					'radiograph.upload_completed',
					'radiograph.original_access_granted',
					'radiograph.trashed',
					'radiograph.restored'
				])
		);
		const actions = new Set(audit.map((row) => row.action));
		for (const action of [
			'radiograph.upload_started',
			'radiograph.upload_completed',
			'radiograph.original_access_granted',
			'radiograph.trashed',
			'radiograph.restored'
		]) {
			expect(actions.has(action)).toBe(true);
		}
		expect(audit.every((row) => row.result === 'success')).toBe(true);
	});

	test('la lista pagina y busca globalmente, conserva contexto y recepción no descubre imágenes', async ({
		page,
		browser
	}) => {
		if (!fixture) throw new Error('Fixture no preparado.');

		await login(page, fixture.ownerEmail);
		await page.goto('/odonto/pacientes');
		await expect(page.locator('tbody tr')).toHaveCount(30);
		await expect(page.getByRole('button', { name: 'Ver más pacientes' })).toBeVisible();

		const search = page.getByLabel('Buscar pacientes');
		let singleCharacterRequests = 0;
		const countSingleCharacterRequest = (request: { url(): string }) => {
			const requestUrl = new URL(request.url());
			if (requestUrl.pathname.endsWith('/odonto/pacientes/lista') && requestUrl.searchParams.get('q') === 'a') {
				singleCharacterRequests += 1;
			}
		};
		page.on('request', countSingleCharacterRequest);
		await search.fill('a');
		await page.waitForTimeout(650);
		expect(singleCharacterRequests).toBe(0);
		page.off('request', countSingleCharacterRequest);

		await search.fill('unico lejano');
		await expect(
			page.locator('tbody').getByText(fixture.hiddenPatientName, { exact: true })
		).toBeVisible();
		await expect(page).toHaveURL(/q=unico(?:%20|\+)lejano/);

		await search.fill('');
		await expect(page.locator('tbody tr')).toHaveCount(30);
		await page.getByRole('button', { name: 'Ver más pacientes' }).click();
		await expect(page.locator('tbody tr')).toHaveCount(32);
		await expect(page.getByRole('button', { name: 'Ver más pacientes' })).toHaveCount(0);

		const distantRow = page.locator('tbody tr').filter({ hasText: fixture.hiddenPatientName });
		await distantRow.getByRole('button', { name: 'Abrir paciente' }).click();
		await expect(page.getByRole('heading', { name: fixture.hiddenPatientName })).toBeVisible();
		await page.getByRole('link', { name: 'Atrás' }).click();
		await expect(page.locator('tbody tr')).toHaveCount(32);

		await page.getByRole('link', { name: /^Archivados \(1\)$/ }).click();
		await expect(page).toHaveURL(/estado=archivados/);
		await expect(
			page.locator('tbody').getByText(fixture.archivedPatientName, { exact: true })
		).toBeVisible();
		await expect(page.locator('tbody tr')).toHaveCount(1);

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: 'Imágenes y radiografías' })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
				)
			)
			.toBe(true);

		const receptionContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
		const receptionPage = await receptionContext.newPage();
		await login(receptionPage, fixture.receptionEmail);
		await receptionPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(receptionPage.getByText('Tu rol no permite ver imágenes clínicas.')).toBeVisible();
		await expect(receptionPage.getByText('Panorámica compartida del equipo')).toHaveCount(0);
		await expect(receptionPage.getByRole('button', { name: 'Añadir imagen' })).toHaveCount(0);
		await receptionContext.close();
	});
});
