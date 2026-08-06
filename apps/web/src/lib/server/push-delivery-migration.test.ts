import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260805163000_decouple_push_delivery_from_feedback.sql',
		import.meta.url
	),
	'utf8'
);

describe('contrato de entrega push independiente de la respuesta', () => {
	it('reclama recordatorios vigentes aunque la prueba todavía no fue confirmada', () => {
		const claimFunction = migration.slice(
			migration.indexOf('create or replace function public.claim_due_push_reminders'),
			migration.indexOf('revoke all on function public.claim_due_push_reminders')
		);

		expect(claimFunction).not.toContain('verified_at');
		expect(claimFunction.match(/ps\.revoked_at is null/g)).toHaveLength(2);
		expect(claimFunction).toContain("a.status in ('reserved', 'confirmed')");
		expect(claimFunction).toContain("a.starts_at <= claim_now + interval '24 hours'");
		expect(claimFunction).toContain("a.starts_at <= claim_now + interval '2 hours'");
		expect(claimFunction.match(/for update of ps skip locked/g)).toHaveLength(2);
	});

	it('mantiene la RPC restringida al servicio interno', () => {
		expect(migration).toContain(
			'revoke all on function public.claim_due_push_reminders(timestamptz, integer)'
		);
		expect(migration).toContain('from public, anon, authenticated');
		expect(migration).toContain('to service_role');
	});
});
