import { redirect, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = ({ cookies }) => {
	const options = { path: '/' };
	cookies.delete('sb-module', options);
	cookies.delete('sb-access-token', options);
	cookies.delete('sb-refresh-token', options);
	throw redirect(303, '/login');
};
