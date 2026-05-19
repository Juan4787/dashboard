import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('Odontologia - flujo base', () => {
	test.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr el test.');

	test('login, crear paciente y eliminar', async ({ page }) => {
		await page.goto('/');

		await page.getByLabel('Email').fill(email ?? '');
		await page.getByLabel('Contraseña').fill(password ?? '');
		await page.locator('form').getByRole('button', { name: 'Ingresar' }).click();

		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();

		const fullName = `E2E Paciente ${Date.now()}`;
		const dni = String(Math.floor(10000000 + Math.random() * 90000000));
		const phone = `11${String(Math.floor(10000000 + Math.random() * 90000000)).slice(0, 8)}`;

		await page.goto('/odonto/pacientes?nuevo=1');
		await expect(page.getByText('Alta rápida de paciente')).toBeVisible();
		await page.locator('#full_name').fill(fullName);
		await page.locator('#dni').fill(dni);
		await page.locator('#phone').fill(phone);
		await page.getByRole('button', { name: 'Crear paciente' }).click();

		await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

		await page.getByRole('link', { name: 'Atrás' }).click();
		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();
		await page.getByPlaceholder('Buscar (nombre, DNI, tel)').fill(fullName);
		const row = page.getByRole('button').filter({ hasText: fullName }).first();
		await expect(row).toBeVisible();

		await row.getByRole('link', { name: 'Abrir paciente' }).click();
		await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

		const deleteUrl = new URL(page.url());
		deleteUrl.searchParams.set('eliminar', '1');
		await page.goto(deleteUrl.toString());
		await page.getByLabel(/Escribí.*eliminar/i).fill('eliminar');
		await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();

		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();
	});
});

test.describe('Reserva pública - modo demo', () => {
	test.skip(process.env.DEMO_MODE !== 'true', 'La reserva pública demo requiere DEMO_MODE=true.');

	test('muestra reserva pública, turno por token y aliases de respuesta', async ({ page }) => {
		await page.goto('/reservar/consultorio-demo');
		await expect(page.getByRole('heading', { name: 'Consultorio demo' })).toBeVisible();
		await expect(page.getByRole('heading', { name: '1. Servicio' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Consulta/i })).toBeVisible();

		await page.goto('/turno/demo-token');
		await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible();
		await expect(page.getByText('Tu turno está reservado.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmo que voy' })).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Necesito reprogramar' })).toBeEnabled();
		await expect(page.getByRole('button', { name: 'Cancelar turno' })).toBeEnabled();

		await page.goto('/confirmar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=confirmar$/);
		await page.goto('/cancelar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=cancelar$/);
		await page.goto('/reprogramar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=reprogramar$/);
	});
});
