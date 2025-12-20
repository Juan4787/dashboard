import { test, expect } from '@playwright/test';

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('Odontologia - flujo base', () => {
	test('login, crear paciente y eliminar', async ({ page }) => {
		test.skip(!email || !password, 'Definí E2E_EMAIL y E2E_PASSWORD para correr el test.');

		await page.goto('/');

		await page.getByLabel('Email').fill(email ?? '');
		await page.getByLabel('Contraseña').fill(password ?? '');
		await page.locator('form').getByRole('button', { name: 'Ingresar' }).click();

		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();

		const fullName = `E2E Paciente ${Date.now()}`;
		const dni = String(Math.floor(10000000 + Math.random() * 90000000));

		await page.getByRole('button', { name: '+ Nuevo paciente' }).click();
		await expect(page.getByText('Alta rápida de paciente')).toBeVisible();
		await page.getByLabel(/Nombre y apellido/i).fill(fullName);
		await page.getByLabel(/DNI/i).fill(dni);
		await page.getByLabel(/Teléfono/i).fill('1133445566');
		await page.getByRole('button', { name: 'Crear paciente' }).click();

		await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

		await page.getByRole('link', { name: 'Atrás' }).click();
		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();
		await page.getByPlaceholder('Buscar (nombre, DNI, tel)').fill(fullName);
		const row = page.locator('.table-row-group .table-row').filter({ hasText: fullName });
		await expect(row).toHaveCount(1);
		await expect(row).toBeVisible();

		await row.getByRole('button', { name: 'Abrir paciente' }).click();
		await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

		await page.getByRole('button', { name: 'Eliminar paciente' }).click();
		await page.getByLabel(/Escribí.*eliminar/i).fill('eliminar');
		await page.getByRole('button', { name: 'Eliminar definitivamente' }).click();

		await expect(page.getByRole('heading', { name: 'Pacientes' })).toBeVisible();
	});
});
