import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	if (locals.auth.module !== 'administrativo') {
		throw redirect(303, '/odonto/pacientes');
	}
	return { module: 'administrativo' as const };
};
