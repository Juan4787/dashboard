import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	supabase: {
		from: vi.fn(),
		rpc: vi.fn()
	}
}));

vi.mock('$lib/server/supabase', () => ({
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId
}));

vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));

const { actions } = await import('./+page.server');

const businessId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const patientId = '00000000-0000-4000-8000-000000000003';

const allCapabilities = {
	canViewExistingPatients: true,
	canViewExistingClinicalNotes: true,
	canViewExistingCosts: true,
	canCreatePatient: true,
	canEditPatient: true,
	canCreateAppointment: true,
	canEditAppointment: true,
	canCancelAppointment: true,
	canRescheduleAppointment: true,
	canUsePublicBooking: true,
	canManageServices: true,
	canManageProfessionals: true,
	canManageAvailability: true,
	canCreateClinicalEntry: true,
	canEditClinicalEntry: true,
	canLinkExternalFiles: true,
	canManageUsers: true,
	canRequestExport: true,
	canViewSubscription: true
};

const makeEvent = (formData = new FormData()) =>
	({
		request: new Request('http://localhost/odonto/pacientes/test', {
			method: 'POST',
			body: formData
		}),
		params: { id: patientId },
		locals: { auth: { access_token: 'test-token' } },
		fetch,
		cookies: {}
	}) as any;

const expectRedirectToPatient = async (promise: unknown) => {
	try {
		await promise;
		throw new Error('Expected redirect');
	} catch (err) {
		expect(err).toMatchObject({
			status: 303,
			location: `/odonto/pacientes/${patientId}`
		});
	}
};

describe('patient detail migrated actions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(mocks.supabase);
		mocks.getAuthUserId.mockResolvedValue(ownerId);
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: businessId },
			role: 'owner',
			access: { allowedCapabilities: { ...allCapabilities } }
		});
	});

	it('stores clinical entry amounts in clinical_entry_costs instead of clinical_entries', async () => {
		const clinicalInsert = vi.fn((_payload: Record<string, unknown>) => ({
			select: vi.fn(() => ({
				single: vi.fn(async () => ({ data: { id: 'entry-1' }, error: null }))
			}))
		}));
		const costUpsert = vi.fn(async () => ({ error: null }));
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'clinical_entries') return { insert: clinicalInsert };
			if (table === 'clinical_entry_costs') return { upsert: costUpsert };
			throw new Error(`Unexpected table ${table}`);
		});

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');
		form.set('teeth', '11');
		form.set('amount', '12.000');
		form.set('internal_note', 'nota interna');

		await expectRedirectToPatient(actions.add_entry!(makeEvent(form)));

		expect(clinicalInsert).toHaveBeenCalledTimes(1);
		expect(clinicalInsert.mock.calls[0][0]).toEqual(
			expect.objectContaining({
				owner_id: ownerId,
				business_id: businessId,
				patient_id: patientId,
				entry_type: 'Consulta',
				description: 'Control clinico',
				teeth: '11',
				internal_note: 'nota interna'
			})
		);
		expect(clinicalInsert.mock.calls[0][0]).not.toHaveProperty('amount');
		expect(costUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				business_id: businessId,
				clinical_entry_id: 'entry-1',
				amount: 12000,
				created_by: ownerId,
				updated_by: ownerId
			}),
			{ onConflict: 'business_id,clinical_entry_id' }
		);
	});

	it('archives patients through the safe RPC instead of direct table updates', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: null });

		try {
			await actions.archive_patient!(makeEvent());
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/odonto/pacientes?estado=archivados'
			});
		}

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('set_patient_archive_state_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_archived: true
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('updates clinical entry text separately from its amount', async () => {
		const maybeSingle = vi.fn(async () => ({ data: { id: 'entry-1' }, error: null }));
		const select = vi.fn(() => ({ maybeSingle }));
		const updateEqChain = { eq: vi.fn(() => undefined as any), select };
		updateEqChain.eq.mockReturnValue(updateEqChain);
		const clinicalUpdate = vi.fn((_payload: Record<string, unknown>) => updateEqChain);
		const costUpsert = vi.fn(async () => ({ error: null }));
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'clinical_entries') return { update: clinicalUpdate };
			if (table === 'clinical_entry_costs') return { upsert: costUpsert };
			throw new Error(`Unexpected table ${table}`);
		});

		const form = new FormData();
		form.set('entry_id', 'entry-1');
		form.set('entry_type', 'Tratamiento');
		form.set('description', 'Evolucion controlada');
		form.set('created_at', '2026-06-05T10:00');
		form.set('teeth', '21');
		form.set('amount', '18.500');
		form.set('internal_note', 'seguimiento');

		await expectRedirectToPatient(actions.update_entry!(makeEvent(form)));

		expect(clinicalUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				entry_type: 'Tratamiento',
				description: 'Evolucion controlada',
				teeth: '21',
				internal_note: 'seguimiento'
			})
		);
		expect(clinicalUpdate.mock.calls[0][0]).not.toHaveProperty('amount');
		expect(clinicalUpdate.mock.calls[0][0]).not.toHaveProperty('created_at');
		expect(costUpsert).toHaveBeenCalledWith(
			expect.objectContaining({
				business_id: businessId,
				clinical_entry_id: 'entry-1',
				amount: 18500,
				updated_by: ownerId
			}),
			{ onConflict: 'business_id,clinical_entry_id' }
		);
	});

	it('unarchives patients through the safe RPC', async () => {
		mocks.supabase.rpc.mockResolvedValue({ error: null });

		try {
			await actions.unarchive_patient!(makeEvent());
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: '/odonto/pacientes'
			});
		}

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('set_patient_archive_state_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_archived: false
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('does not attempt direct destructive patient deletion', async () => {
		const result = (await actions.delete_patient!(makeEvent())) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toContain('no se eliminan directamente');
		expect(mocks.supabase.from).not.toHaveBeenCalled();
		expect(mocks.supabase.rpc).not.toHaveBeenCalled();
	});
});
