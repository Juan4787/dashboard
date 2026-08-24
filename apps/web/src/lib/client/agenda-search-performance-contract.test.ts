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

	it('warms a private bounded snapshot on Agenda navigation and keeps server reconciliation', () => {
		const agenda = readSource('../../routes/odonto/agenda/+page.svelte');
		const preloadEndpoint = readSource(
			'../../routes/odonto/agenda/buscar/precarga/+server.ts'
		);

		expect(agenda).toContain("fetch('/odonto/agenda/buscar/precarga'");
		expect(agenda).toContain('filterAgendaAppointmentSnapshot(');
		expect(agenda).toContain("if (to?.url.pathname === '/odonto/agenda')");
		expect(agenda).toContain('void loadLiveSnapshot();');
		expect(agenda).toContain('onpointerenter={() => void loadLiveSnapshot()}');
		expect(agenda).toContain('liveResolvedQuery === liveQuery && liveResults');
		expect(agenda).not.toContain('localStorage');
		expect(preloadEndpoint).toContain("'cache-control': 'private, no-store'");
		expect(preloadEndpoint).toContain("rpc('list_upcoming_active_appointments_snapshot'");
	});

	it('keeps the live loading status inside the fixed query row', () => {
		const agenda = readSource('../../routes/odonto/agenda/+page.svelte');

		expect(agenda).toContain('flex h-5 min-w-0 items-center gap-2');
		expect(agenda).toContain("{liveLoading ? 'Buscando…' : ''}");
		expect(agenda).not.toContain('{#if liveActive && liveLoading}');
	});
});
