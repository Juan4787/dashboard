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

	it('creates clinical entries through the safe RPC instead of direct table writes', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: 'entry-1', error: null });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');
		form.set('teeth', '11');
		form.set('amount', '12.000');
		form.set('internal_note', 'nota interna');

		await expectRedirectToPatient(actions.add_entry!(makeEvent(form)));

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('create_clinical_entry_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_entry_type: 'Consulta',
			p_description: 'Control clinico',
			p_created_at: expect.any(String),
			p_teeth: '11',
			p_internal_note: 'nota interna',
			p_amount: 12000
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('returns a specific patient error when the clinical entry RPC rejects the patient scope', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'PATIENT_NOT_FOUND' } });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');

		const result = (await actions.add_entry!(makeEvent(form))) as any;

		expect(result.status).toBe(404);
		expect(result.data.message).toBe('Paciente no encontrado en este consultorio.');
		expect(mocks.supabase.rpc).toHaveBeenCalledWith('create_clinical_entry_safely', expect.any(Object));
		expect(mocks.supabase.from).not.toHaveBeenCalled();
	});

	it('returns a specific permission error when the clinical entry RPC denies write access', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: { message: 'CLINICAL_ENTRY_DENIED' } });

		const form = new FormData();
		form.set('entry_type', 'Consulta');
		form.set('description', 'Control clinico');
		form.set('created_at', '2026-06-05T09:30');

		const result = (await actions.add_entry!(makeEvent(form))) as any;

		expect(result.status).toBe(403);
		expect(result.data.message).toBe('Tu rol no permite modificar la historia clinica de este paciente.');
		expect(mocks.supabase.from).not.toHaveBeenCalled();
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

	it('updates clinical entries through the safe RPC instead of direct table writes', async () => {
		mocks.supabase.rpc.mockResolvedValue({ data: null, error: null });

		const form = new FormData();
		form.set('entry_id', 'entry-1');
		form.set('entry_type', 'Tratamiento');
		form.set('description', 'Evolucion controlada');
		form.set('created_at', '2026-06-05T10:00');
		form.set('teeth', '21');
		form.set('amount', '18.500');
		form.set('internal_note', 'seguimiento');

		await expectRedirectToPatient(actions.update_entry!(makeEvent(form)));

		expect(mocks.supabase.rpc).toHaveBeenCalledWith('update_clinical_entry_safely', {
			p_business_id: businessId,
			p_patient_id: patientId,
			p_entry_id: 'entry-1',
			p_entry_type: 'Tratamiento',
			p_description: 'Evolucion controlada',
			p_teeth: '21',
			p_internal_note: 'seguimiento',
			p_amount: 18500
		});
		expect(mocks.supabase.from).not.toHaveBeenCalled();
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
