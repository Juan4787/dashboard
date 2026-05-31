import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('Odontologia - flujo base', () => {
	test.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr el test.');

	test('login y navegación principal', async ({ page }) => {
		await page.goto('/');

		await page.getByLabel('Correo electrónico').fill(email ?? '');
		await page.getByLabel('Contraseña').fill(password ?? '');
		await page.locator('form').getByRole('button', { name: 'Ingresar' }).click();

		await expect(page.getByRole('link', { name: 'Agenda' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Pacientes' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Profesionales' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Configuración' })).toBeVisible();
	});
});

test.describe('Reserva pública - modo demo', () => {
	test.skip(process.env.DEMO_MODE !== 'true', 'La reserva pública demo requiere DEMO_MODE=true.');

	test('muestra reserva pública, turno por token y aliases de respuesta', async ({ page }) => {
		await page.goto('/reservar/consultorio-demo');
		await expect(page.getByRole('heading', { name: 'Consultorio demo' })).toBeVisible();
		await expect(page.getByRole('heading', { name: '¿Qué necesitás?' })).toBeVisible();
		await expect(page.getByRole('link', { name: /Consulta/i })).toBeVisible();

		await page.goto('/turno/demo-token');
		await expect(page.getByRole('heading', { name: 'Tu turno' })).toBeVisible();
		await expect(page.getByText('Tu turno está reservado.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmo que voy' })).toBeEnabled();
		await expect(page.getByText('Necesito reprogramar')).toBeVisible();
		await expect(page.getByText('Cancelar turno')).toBeVisible();

		await page.goto('/confirmar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=confirmar$/);
		await page.goto('/cancelar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=cancelar$/);
		await page.goto('/reprogramar/demo-token');
		await expect(page).toHaveURL(/\/turno\/demo-token\?accion=reprogramar$/);
	});
});
