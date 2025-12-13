import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}
	if (locals.auth.module !== 'odonto') {
		throw redirect(303, '/administrativo/expedientes');
	}
	return { module: 'odonto' as const };
};
