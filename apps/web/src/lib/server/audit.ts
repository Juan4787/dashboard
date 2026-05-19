import type { SupabaseClient } from '@supabase/supabase-js';

export const writeAuditLog = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		userId?: string | null;
		action: string;
		entityType: string;
		entityId?: string | null;
		metadata?: Record<string, unknown> | null;
	}
) => {
	const { error } = await supabase.from('audit_logs').insert({
		business_id: input.businessId,
		user_id: input.userId ?? null,
		action: input.action,
		entity_type: input.entityType,
		entity_id: input.entityId ?? null,
		metadata: input.metadata ?? null
	});

	if (error) {
		console.error('Error registrando auditoria', error);
	}
};
