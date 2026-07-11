export type AttendingActorRole = 'owner' | 'admin' | 'reception' | 'professional' | 'readonly';
export type AttendingTargetRole = AttendingActorRole;

export const canConfigureAttendingProfile = ({
	actorRole,
	targetRole,
	isAssisting
}: {
	actorRole: AttendingActorRole;
	targetRole: AttendingTargetRole;
	isAssisting: boolean;
}) => {
	if (targetRole !== 'owner' && targetRole !== 'admin') return false;
	if (actorRole === 'owner') return true;
	if (actorRole !== 'admin') return false;
	return targetRole === 'admin' || isAssisting;
};
