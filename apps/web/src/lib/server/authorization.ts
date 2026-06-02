import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessContext, BusinessRole } from './business';

export const CAPABILITIES = [
	'canViewAgenda',
	'canViewOwnAppointments',
	'canCreateAppointment',
	'canEditAppointment',
	'canCancelAppointment',
	'canRescheduleAppointment',
	'canMarkAppointmentAttendance',
	'canViewBasicPatients',
	'canCreateBasicPatient',
	'canEditBasicPatient',
	'canArchivePatient',
	'canDeletePatient',
	'canViewClinicalProfile',
	'canEditClinicalProfile',
	'canViewClinicalEntries',
	'canCreateClinicalEntry',
	'canEditOwnClinicalEntry',
	'canEditAnyClinicalEntry',
	'canViewCosts',
	'canViewRadiologyReferences',
	'canLinkExternalFiles',
	'canConfigureProfessionals',
	'canConfigureServices',
	'canConfigureAvailability',
	'canConfigureBusiness',
	'canManageUsers',
	'canInviteOwner',
	'canInviteAdmin',
	'canInviteReception',
	'canInviteProfessional',
	'canDisableOwner',
	'canDisableAdmin',
	'canDisableReception',
	'canDisableProfessional',
	'canManageSubscription',
	'canConfigureCommunication',
	'canRequestExport',
	'canUsePublicBooking',
	'canAccessMasterPanel'
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type CapabilityMap = Record<Capability, boolean>;

export type AuthorizationReasonCode =
	| 'LAST_OWNER_BLOCKED'
	| 'PATIENT_ACCESS_DENIED'
	| 'RECEPTION_CLINICAL_DENIED'
	| 'EMAIL_ALREADY_ASSIGNED'
	| 'MULTI_MEMBERSHIP_BLOCKED'
	| 'COMMERCIAL_RESTRICTED'
	| 'SERVICE_ROLE_ACTION_DENIED'
	| 'PUBLIC_BOOKING_RATE_LIMITED'
	| 'PUBLIC_TOKEN_DENIED'
	| 'PROFESSIONAL_LINK_REQUIRED'
	| 'ADMIN_OWNER_ACTION_DENIED'
	| 'CAPABILITY_DENIED';

export class AuthorizationError extends Error {
	status = 403;
	reasonCode: AuthorizationReasonCode;
	capability?: Capability;

	constructor(message: string, reasonCode: AuthorizationReasonCode = 'CAPABILITY_DENIED', capability?: Capability) {
		super(message);
		this.name = 'AuthorizationError';
		this.reasonCode = reasonCode;
		this.capability = capability;
	}
}

const emptyCapabilities = (): CapabilityMap =>
	Object.fromEntries(CAPABILITIES.map((capability) => [capability, false])) as CapabilityMap;

const fullOwnerCapabilities = (): CapabilityMap => ({
	...emptyCapabilities(),
	canViewAgenda: true,
	canViewOwnAppointments: true,
	canCreateAppointment: true,
	canEditAppointment: true,
	canCancelAppointment: true,
	canRescheduleAppointment: true,
	canMarkAppointmentAttendance: true,
	canViewBasicPatients: true,
	canCreateBasicPatient: true,
	canEditBasicPatient: true,
	canArchivePatient: true,
	canDeletePatient: false,
	canViewClinicalProfile: true,
	canEditClinicalProfile: true,
	canViewClinicalEntries: true,
	canCreateClinicalEntry: true,
	canEditOwnClinicalEntry: true,
	canEditAnyClinicalEntry: true,
	canViewCosts: true,
	canViewRadiologyReferences: true,
	canLinkExternalFiles: true,
	canConfigureProfessionals: true,
	canConfigureServices: true,
	canConfigureAvailability: true,
	canConfigureBusiness: true,
	canManageUsers: true,
	canInviteOwner: true,
	canInviteAdmin: true,
	canInviteReception: true,
	canInviteProfessional: true,
	canDisableOwner: true,
	canDisableAdmin: true,
	canDisableReception: true,
	canDisableProfessional: true,
	canManageSubscription: true,
	canConfigureCommunication: true,
	canRequestExport: true,
	canUsePublicBooking: true,
	canAccessMasterPanel: false
});

const ROLE_CAPABILITIES: Record<BusinessRole, CapabilityMap> = {
	owner: fullOwnerCapabilities(),
	admin: {
		...fullOwnerCapabilities(),
		canInviteOwner: false,
		canInviteAdmin: false,
		canDisableOwner: false,
		canDisableAdmin: false,
		canManageSubscription: false,
		canAccessMasterPanel: false
	},
	reception: {
		...emptyCapabilities(),
		canViewAgenda: true,
		canCreateAppointment: true,
		canEditAppointment: true,
		canCancelAppointment: true,
		canRescheduleAppointment: true,
		canViewBasicPatients: true,
		canCreateBasicPatient: true,
		canEditBasicPatient: true
	},
	professional: {
		...emptyCapabilities(),
		canViewOwnAppointments: true,
		canMarkAppointmentAttendance: true,
		canViewBasicPatients: true,
		canViewClinicalProfile: true,
		canViewClinicalEntries: true,
		canCreateClinicalEntry: true,
		canEditOwnClinicalEntry: true,
		canViewRadiologyReferences: true,
		canLinkExternalFiles: true
	},
	readonly: {
		...emptyCapabilities(),
		canViewAgenda: true,
		canViewBasicPatients: true
	}
};

export const getRoleCapabilities = (role: BusinessRole): CapabilityMap => ({
	...emptyCapabilities(),
	...(ROLE_CAPABILITIES[role] ?? {})
});

export const getEffectiveCapabilities = (context: {
	role: BusinessRole;
	access: BusinessContext['access'];
}): CapabilityMap => {
	const roleCapabilities = getRoleCapabilities(context.role);
	const status = context.access.commercialStatus;

	if (status === 'active' || status === 'grace') {
		return {
			...roleCapabilities,
			canUsePublicBooking: roleCapabilities.canUsePublicBooking && context.access.allowedCapabilities.canUsePublicBooking
		};
	}

	const restricted = emptyCapabilities();
	if (status === 'restricted') {
		if (context.role === 'owner' || context.role === 'admin') {
			restricted.canManageSubscription = context.role === 'owner';
			restricted.canRequestExport = true;
		}
		return restricted;
	}

	if (status === 'archived' && context.role === 'owner') {
		restricted.canManageSubscription = true;
		restricted.canRequestExport = true;
	}
	return restricted;
};

export const hasCapability = (context: Pick<BusinessContext, 'capabilities'>, capability: Capability) =>
	Boolean(context.capabilities?.[capability]);

export const capabilityMessage = (capability: Capability) => {
	if (capability.includes('Clinical')) return 'Tu rol no permite ver o modificar esta información clínica.';
	if (capability.includes('Availability')) return 'Sólo el dueño o administrador puede modificar los horarios de atención.';
	if (capability.includes('Services')) return 'Sólo el dueño o administrador puede modificar los servicios.';
	if (capability.includes('Users')) return 'No tenés permisos para administrar usuarios.';
	if (capability.includes('Subscription')) return 'No tenés permisos para ver o modificar la suscripción.';
	return 'No tenés permiso para realizar esta acción.';
};

export const requireCapability = (
	context: Pick<BusinessContext, 'capabilities' | 'access'>,
	capability: Capability,
	message = capabilityMessage(capability)
) => {
	if (context.access.commercialStatus === 'restricted' || context.access.commercialStatus === 'archived') {
		if (!hasCapability(context, capability)) {
			throw new AuthorizationError(
				'La cuenta está suspendida. Regularizá la suscripción para volver a operar.',
				'COMMERCIAL_RESTRICTED',
				capability
			);
		}
	}
	if (!hasCapability(context, capability)) {
		throw new AuthorizationError(message, 'CAPABILITY_DENIED', capability);
	}
};

export const failFromAuthorization = (error: unknown) => {
	if (error instanceof AuthorizationError) {
		return { status: error.status, message: error.message, reasonCode: error.reasonCode };
	}
	return null;
};

export const auditDenied = async (
	supabase: SupabaseClient,
	input: {
		businessId: string;
		userId: string | null;
		action: string;
		entityType: string;
		entityId?: string | null;
		reasonCode: AuthorizationReasonCode;
		metadata?: Record<string, unknown>;
	}
) => {
	await supabase.rpc('audit_security_event', {
		p_business_id: input.businessId,
		p_user_id: input.userId,
		p_action: input.action,
		p_entity_type: input.entityType,
		p_entity_id: input.entityId ?? null,
		p_result: 'blocked',
		p_reason_code: input.reasonCode,
		p_metadata: input.metadata ?? {}
	});
};

export const requirePatientAccess = async (
	supabase: SupabaseClient,
	context: BusinessContext,
	patientId: string,
	mode: 'basic' | 'clinical' | 'radiology' = 'basic'
) => {
	const rpc =
		mode === 'clinical'
			? 'user_can_read_clinical_patient'
			: mode === 'radiology'
				? 'user_can_read_radiology_reference'
				: 'user_can_read_basic_patient';
	const { data, error } = await supabase.rpc(rpc, {
		target_business_id: context.business.id,
		target_patient_id: patientId
	});
	if (error || data !== true) {
		throw new AuthorizationError('No tenés acceso a este paciente.', 'PATIENT_ACCESS_DENIED');
	}
};
