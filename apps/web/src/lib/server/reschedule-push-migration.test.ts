import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260702151000_reset_push_reminders_on_reschedule.sql',
		import.meta.url
	),
	'utf8'
);

describe('reseteo transaccional de recordatorios al reprogramar', () => {
	it('se dispara únicamente cuando cambia starts_at y limpia las dos ventanas', () => {
		expect(migration).toContain('after update of starts_at on appointments');
		expect(migration).toContain('when (new.starts_at is distinct from old.starts_at)');
		expect(migration).toContain('push_24h_claimed_at = null');
		expect(migration).toContain('push_24h_sent_at = null');
		expect(migration).toContain('push_2h_claimed_at = null');
		expect(migration).toContain('push_2h_sent_at = null');
	});

	it('preserva endpoints muertos y no condiciona el reseteo a la confirmación de la prueba', () => {
		const functionBody = migration.slice(
			migration.indexOf('create or replace function public.reset_push_reminders_on_reschedule'),
			migration.indexOf('drop trigger if exists appointments_reset_push_reminders')
		);
		expect(functionBody).toContain('and revoked_at is null');
		expect(functionBody).not.toContain('verified_at');
	});
});
