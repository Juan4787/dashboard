import { describe, expect, it } from 'vitest';
import { canConfigureAttendingProfile } from './team-permissions';

describe('attending-profile authority', () => {
	it('lets an owner configure both owner and admin profiles', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'owner', targetRole: 'owner', isAssisting: false })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'owner', targetRole: 'admin', isAssisting: false })).toBe(true);
	});

	it('keeps a regular admin from configuring the owner', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'owner', isAssisting: false })).toBe(false);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'admin', isAssisting: false })).toBe(true);
	});

	it('lets the master configure owner and admin only during active assistance', () => {
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'owner', isAssisting: true })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'admin', isAssisting: true })).toBe(true);
		expect(canConfigureAttendingProfile({ actorRole: 'admin', targetRole: 'reception', isAssisting: true })).toBe(false);
	});
});
