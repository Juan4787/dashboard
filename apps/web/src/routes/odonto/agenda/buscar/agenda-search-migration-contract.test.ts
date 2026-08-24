import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
	new URL(
		'../../../../../../../supabase/migrations/20260823130000_fast_agenda_active_search.sql',
		import.meta.url
	),
	'utf8'
);

describe('fast agenda search migration contract', () => {
	it('runs the active appointment lookup as one bounded and indexed database operation', () => {
		expect(migration).toContain('appointments_business_active_starts_patient_idx');
		expect(migration).toContain('function public.search_upcoming_active_appointments(');
		expect(migration).toContain("appointment.status in ('reserved', 'confirmed', 'reschedule_requested')");
		expect(migration).toContain('appointment.starts_at >= statement_timestamp()');
		expect(migration).toContain('limit v_limit');
	});

	it('preserves accent-insensitive name prefixes, word prefixes and phone matching', () => {
		expect(migration).toContain('public.normalize_patient_search_text');
		expect(migration).toContain("position(' ' in v_query) = 0");
		expect(migration).toContain('patient.search_name_normalized like');
		expect(migration).toContain('length(v_digits) >= 2');
		expect(migration).toContain("patient.search_phone_digits like '%' || v_digits || '%'");
	});

	it('checks tenant access, excludes professional accounts and grants only authenticated execution', () => {
		expect(migration).toContain('public.user_has_business_access(p_business_id)');
		expect(migration).toContain("not in ('owner', 'admin', 'reception', 'readonly')");
		expect(migration).toContain('public.business_allows_operation(p_business_id)');
		expect(migration).toContain(
			'grant execute on function public.search_upcoming_active_appointments(uuid, text, integer)'
		);
	});
});
