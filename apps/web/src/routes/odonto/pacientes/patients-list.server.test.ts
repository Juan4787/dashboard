import { describe, expect, it, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createSupabaseAdminClient: vi.fn(),
	createSupabaseServerClient: vi.fn(),
	getAuthUserId: vi.fn(),
	isJwtExpired: vi.fn(),
	resolveActiveBusiness: vi.fn(),
	supabase: {
		auth: {
			refreshSession: vi.fn()
		},
		from: vi.fn()
	},
	admin: {
		from: vi.fn()
	}
}));

vi.mock('$lib/server/supabase', () => ({
	createSupabaseAdminClient: mocks.createSupabaseAdminClient,
	createSupabaseServerClient: mocks.createSupabaseServerClient,
	getAuthUserId: mocks.getAuthUserId,
	isJwtExpired: mocks.isJwtExpired
}));

vi.mock('$lib/server/business', () => ({
	resolveActiveBusiness: mocks.resolveActiveBusiness
}));

const { actions } = await import('./+page.server');

const businessId = '00000000-0000-4000-8000-000000000001';
const professionalUserId = '00000000-0000-4000-8000-000000000002';
const professionalId = '00000000-0000-4000-8000-000000000003';
const patientId = '00000000-0000-4000-8000-000000000004';

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
		request: new Request('http://localhost/odonto/pacientes', {
			method: 'POST',
			body: formData
		}),
		locals: {
			auth: {
				module: 'odonto',
				access_token: 'test-token',
				refresh_token: 'refresh-token'
			}
		},
		fetch,
		cookies: {
			set: vi.fn()
		}
	}) as any;

const chain = <T extends Record<string, unknown>>(extra: T) => {
	const builder: Record<string, any> = { ...extra };
	for (const method of ['select', 'eq', 'order', 'limit']) {
		builder[method] = vi.fn(() => builder);
	}
	return builder;
};

describe('patients create action', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.createSupabaseServerClient.mockResolvedValue(mocks.supabase);
		mocks.createSupabaseAdminClient.mockResolvedValue(mocks.admin);
		mocks.getAuthUserId.mockResolvedValue(professionalUserId);
		mocks.isJwtExpired.mockReturnValue(false);
		mocks.resolveActiveBusiness.mockResolvedValue({
			business: { id: businessId },
			role: 'professional',
			access: { allowedCapabilities: { ...allCapabilities } }
		});
	});

	it('links a patient created by a professional before redirecting to the patient detail', async () => {
		const patientInsertBuilder = {
			insert: vi.fn(() => ({
				select: vi.fn(() => ({
					single: vi.fn(async () => ({ data: { id: patientId }, error: null }))
				}))
			}))
		};
		mocks.supabase.from.mockImplementation((table: string) => {
			if (table === 'patients') return patientInsertBuilder;
			throw new Error(`Unexpected table ${table}`);
		});

		const professionalUserBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: { professional_id: professionalId }, error: null }))
		});
		const professionalPatientLinkBuilder = chain({
			maybeSingle: vi.fn(async () => ({ data: null, error: null })),
			insert: vi.fn(async () => ({ error: null }))
		});
		mocks.admin.from.mockImplementation((table: string) => {
			if (table === 'professional_users') return professionalUserBuilder;
			if (table === 'professional_patient_links') return professionalPatientLinkBuilder;
			throw new Error(`Unexpected admin table ${table}`);
		});

		const form = new FormData();
		form.set('full_name', 'Paciente Profesional');
		form.set('phone', '+54 9 11 5555-5555');

		try {
			await actions.create_patient!(makeEvent(form));
			throw new Error('Expected redirect');
		} catch (err) {
			expect(err).toMatchObject({
				status: 303,
				location: `/odonto/pacientes/${patientId}`
			});
		}

		expect(professionalPatientLinkBuilder.insert).toHaveBeenCalledWith({
			business_id: businessId,
			professional_id: professionalId,
			patient_id: patientId,
			source: 'manual',
			created_by: professionalUserId
		});
	});
});
