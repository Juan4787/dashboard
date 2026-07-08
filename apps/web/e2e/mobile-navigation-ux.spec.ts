import { expect, test } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('Odontología mobile - navegación', () => {
	test.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr el test mobile.');

	test.use({
		viewport: { width: 390, height: 844 },
		isMobile: true
	});

	test('menú vertical muestra opciones y cerrar sesión sin rotar el teléfono', async ({ page }) => {
		await page.goto('/login');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Correo electrónico').fill(email ?? '');
		await page.getByLabel('Contraseña').fill(password ?? '');
		await page.locator('form').first().getByRole('button', { name: 'Ingresar', exact: true }).click();
		await expect(page).toHaveURL(/\/odonto/);

		await page.goto('/odonto/agenda');
		await page.waitForLoadState('networkidle');
		await expect(page.getByRole('button', { name: 'Abrir menú' }).last()).toBeVisible();

		const bottomNav = page.getByRole('navigation', { name: 'Navegación principal' });
		if (await bottomNav.isVisible().catch(() => false)) {
			await expect(bottomNav.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
			await expect(bottomNav.locator('svg').first()).toBeVisible();
			await page.screenshot({ path: 'output/playwright/mobile-bottom-nav.png', fullPage: false });
		}

		await page.getByRole('button', { name: 'Abrir menú' }).last().click();
		const dialog = page.getByRole('dialog', { name: 'Menú de navegación' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText('Cuenta')).toBeVisible();
		await expect(dialog.getByRole('link', { name: 'Salir' })).toBeVisible();
		await expect(dialog.getByRole('link', { name: 'Salir' })).toBeInViewport();
		await page.screenshot({ path: 'output/playwright/mobile-menu-open.png', fullPage: false });
	});
});
