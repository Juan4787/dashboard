import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('agenda search performance contracts', () => {
	it('does not scan the patient table before looking up appointments', () => {
		const endpoint = readSource('../../routes/odonto/agenda/buscar/+server.ts');

		expect(endpoint).toContain("rpc('search_upcoming_active_appointments'");
		expect(endpoint).not.toContain("from('patients')");
		expect(endpoint).not.toContain('PATIENT_SCAN_LIMIT');
	});

	it('matches the patient search debounce and cancels stale browser requests', () => {
		const agenda = readSource('../../routes/odonto/agenda/+page.svelte');

		expect(agenda).toContain('new AbortController()');
		expect(agenda).toContain('liveController?.abort()');
		expect(agenda).toContain('loadLiveResults(query, request), 120');
	});
});
