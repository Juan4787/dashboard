import { expect, test } from '@playwright/test';

test.describe('Google Auth', () => {
	test('el botón de Google inicia OAuth contra Google', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: 'Ingresar con Google' }).click();
		await page.waitForURL(/accounts\.google\.com|yjzferwuzbtgpmdnzlcb\.supabase\.co/, {
			timeout: 20_000
		});
		await expect(page).toHaveURL(/accounts\.google\.com|yjzferwuzbtgpmdnzlcb\.supabase\.co/);
	});

	test('crear cuenta con Google inicia OAuth si aceptó términos', async ({ page }) => {
		await page.goto('/login');
		await page.getByRole('button', { name: 'Crear cuenta' }).click();
		await expect(page.getByRole('button', { name: 'Crear cuenta con Google' })).toBeDisabled();
		await page.getByRole('checkbox', { name: /Leí y acepto/i }).check();
		await page.getByRole('button', { name: 'Crear cuenta con Google' }).click();
		await page.waitForURL(/accounts\.google\.com|yjzferwuzbtgpmdnzlcb\.supabase\.co/, {
			timeout: 20_000
		});
		await expect(page).toHaveURL(/accounts\.google\.com|yjzferwuzbtgpmdnzlcb\.supabase\.co/);
	});
});
