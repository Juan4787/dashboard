import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
	new URL(
		'../../../../../supabase/migrations/20260804030000_google_calendar_sync.sql',
		import.meta.url
	),
	'utf8'
);

describe('contrato de la migración Google Calendar', () => {
	it('guarda la confirmación explícita para distinguir la cobertura manual', () => {
		expect(migration).toContain('add column if not exists verified_at timestamptz');
		expect(migration).toContain('max(user_confirmed_at) as last_confirmed_at');
		expect(migration).toContain('idx_push_subscriptions_verified_appointment');
	});

	it('aísla secretos y telemetría de clientes públicos', () => {
		for (const table of [
			'google_calendar_connections',
			'google_calendar_oauth_attempts',
			'appointment_google_calendar_events'
		]) {
			expect(migration).toContain(`alter table public.${table} enable row level security`);
			expect(migration).toContain(`revoke all on table public.${table} from anon, authenticated`);
		}
		expect(migration).toContain('refresh_token_ciphertext text');
		expect(migration).not.toMatch(/refresh_token\s+text/i);
		expect(migration).toContain('state_hash text not null unique');
		expect(migration).not.toContain('confirmation_token');
	});

	it('consume OAuth state una sola vez y limita todas las RPC a service_role', () => {
		expect(migration).toContain('attempt.consumed_at is null');
		expect(migration).toContain('attempt.expires_at > p_now');
		expect(migration).toContain('set consumed_at = p_now');
		expect(migration).toMatch(
			/revoke all on function public\.consume_google_calendar_oauth_attempt[\s\S]+from public, anon, authenticated/
		);
		expect(migration).toContain(
			'grant execute on function public.consume_google_calendar_oauth_attempt(text, timestamptz) to service_role'
		);
	});

	it('encola reprogramaciones en la misma transacción y conserva carreras en vuelo', () => {
		expect(migration).toContain('appointments_queue_google_calendar_sync');
		expect(migration).toContain(
			'after update of starts_at, ends_at, status, calendar_sequence on public.appointments'
		);
		expect(migration).toContain("event_id is null then 'pending_create' else 'pending_update'");
		expect(migration).toContain("sync_status not in ('deleted', 'detached', 'pending_delete')");
		expect(migration).toContain(
			'set calendar_update_required_at = coalesce(calendar_update_required_at, now())'
		);
		// El trigger no libera un claim en vuelo: el worker que ya salió hacia Google
		// termina y la RPC de cierre vuelve a encolar la versión nueva.
		const triggerBody = migration.slice(
			migration.indexOf('create or replace function public.queue_google_calendar_sync_on_appointment_change'),
			migration.indexOf('drop trigger if exists appointments_queue_google_calendar_sync')
		);
		expect(triggerBody).not.toContain('claimed_at = null');
	});

	it('cierra create/update sin perder una cancelación o una sequence más nueva', () => {
		expect(migration).toContain("when event_row.sync_status = 'pending_delete' then 'pending_delete'");
		expect(migration).toContain(
			"when appointment_row.calendar_sequence <> p_synced_sequence then 'pending_update'"
		);
		expect(migration).toContain('synced_sequence = p_synced_sequence');
		expect(migration).toContain("calendar_action_status = 'synced_google'");
		expect(migration).toContain('calendar_update_required_at = null');
	});

	it('reclama trabajos sin duplicarlos y con recuperación de claims abandonados', () => {
		expect(migration).toContain('for update skip locked');
		expect(migration).toContain("claimed_at < claim_now - interval '10 minutes'");
		expect(migration).toContain("sync_status in ('pending_create', 'pending_update', 'pending_delete')");
	});
});
