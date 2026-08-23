import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('patient navigation performance contracts', () => {
	it('does not restart active routes when the patient-list revision changes', () => {
		const layoutSource = readSource('../../routes/odonto/+layout.svelte');

		expect(layoutSource).not.toContain("invalidate('app:patients')");
	});

	it('does not race a manual patient preload against the real navigation', () => {
		const patientListSource = readSource('../../routes/odonto/pacientes/+page.svelte');

		expect(patientListSource).not.toContain('preloadData(');
		expect(patientListSource).not.toContain('schedulePatientWarmup');
	});

	it('reuses the already verified membership around patient reads and writes', () => {
		const patientDetailSource = readSource('../../routes/odonto/pacientes/[id]/+page.server.ts');
		const shortReads = patientDetailSource.match(/membershipCache: 'short'/g) ?? [];

		expect(shortReads).toHaveLength(2);
	});
});
