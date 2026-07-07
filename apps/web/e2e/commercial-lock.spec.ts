import { expect, test } from '@playwright/test';

const expiredEmail = process.env.E2E_EXPIRED_EMAIL;
const expiredPassword = process.env.E2E_EXPIRED_PASSWORD;
const validateMpRedirect = process.env.E2E_VALIDATE_MP_REDIRECT === 'true';

test.describe('Acceso comercial vencido', () => {
	test.skip(
		!expiredEmail || !expiredPassword,
		'Definí E2E_EXPIRED_EMAIL y E2E_EXPIRED_PASSWORD para validar una cuenta vencida.'
	);

	test('muestra la pantalla universal y el CTA inicia Mercado Pago sin página intermedia', async ({
		page
	}) => {
		await page.goto('/login');
		await page.getByLabel('Correo electrónico').fill(expiredEmail ?? '');
		await page.getByLabel('Contraseña').fill(expiredPassword ?? '');
		await page.locator('form').getByRole('button', { name: 'Ingresar', exact: true }).click();

		await expect(page.getByRole('heading', { name: 'Tu acceso a Cita Suite venció' })).toBeVisible();
		await expect(page.getByText('Tu agenda, pacientes y configuración siguen guardados.')).toBeVisible();
		const cta = page.getByRole('button', { name: 'Activar suscripción con Mercado Pago' });
		await expect(cta).toBeVisible();

		if (!validateMpRedirect) return;

		await cta.click();
		await page.waitForURL(/mercadopago|mercadolibre/, { timeout: 45_000 });
		await expect(page).toHaveURL(/mercadopago|mercadolibre/);
	});
});
