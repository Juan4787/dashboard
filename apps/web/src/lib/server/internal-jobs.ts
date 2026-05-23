import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

export const assertInternalJobRequest = (request: Request) => {
	const secret = env.INTERNAL_JOB_SECRET?.trim();
	if (!secret) {
		return json({ message: 'Falta configurar INTERNAL_JOB_SECRET.' }, { status: 503 });
	}
	const authorization = request.headers.get('authorization') ?? '';
	const headerSecret = request.headers.get('x-job-secret') ?? '';
	const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
	if (bearer !== secret && headerSecret !== secret) {
		return json({ message: 'No autorizado.' }, { status: 401 });
	}
	return null;
};
