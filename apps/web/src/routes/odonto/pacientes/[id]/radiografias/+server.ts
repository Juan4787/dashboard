import { env } from '$env/dynamic/private';
import { readDemoDb } from '$lib/server/demo-store';
import { getOdontoContext } from '$lib/server/odonto-context';
import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const PAGE_SIZE = 24;

export const GET: RequestHandler = async ({ params, url, locals, fetch, cookies, setHeaders }) => {
	if (!locals.auth) {
		throw redirect(303, '/login');
	}

	const cursorCreatedAt = url.searchParams.get('cursor_created_at')?.trim() ?? '';
	const cursorId = url.searchParams.get('cursor_id')?.trim() ?? '';
	const isInitialPage = !cursorCreatedAt && !cursorId;
	setHeaders({ 'cache-control': 'private, no-store' });

	if (env.DEMO_MODE === 'true') {
		const rows = readDemoDb()
			.radiographs.filter((item) => item.patient_id === params.id)
			.sort((a, b) => {
				const dateA = a.created_at ?? '';
				const dateB = b.created_at ?? '';
				if (dateA === dateB) return a.id < b.id ? 1 : -1;
				return dateA < dateB ? 1 : -1;
			});

		const filtered = cursorCreatedAt
			? rows.filter((item) => {
					const itemDate = item.created_at ?? '';
					if (itemDate < cursorCreatedAt) return true;
					if (itemDate > cursorCreatedAt) return false;
					return cursorId ? item.id < cursorId : false;
				})
			: rows;
		const slice = filtered.slice(0, PAGE_SIZE + 1);
		const hasMore = slice.length > PAGE_SIZE;
		const items = hasMore ? slice.slice(0, PAGE_SIZE) : slice;
		const last = items.at(-1);
		return json({
			items,
			has_more: hasMore,
			next_cursor_created_at: hasMore ? last?.created_at ?? null : null,
			next_cursor_id: hasMore ? last?.id ?? null : null
		});
	}

	const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
	let query = supabase
		.from('patient_radiographs')
		.select(
			'id, patient_id, status, drive_file_id, original_filename, mime_type, bytes, taken_at, note, created_at'
		)
		.eq('patient_id', params.id)
		.eq('business_id', business.business.id)
		.is('deleted_at', null)
		.order('created_at', { ascending: false })
		.order('id', { ascending: false })
		.limit(PAGE_SIZE + 1);

	if (cursorCreatedAt && cursorId) {
		query = query.or(
			`created_at.lt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.lt.${cursorId})`
		);
	} else if (cursorCreatedAt) {
		query = query.lt('created_at', cursorCreatedAt);
	}

	const [radiographsResult, driveResult] = await Promise.all([
		query,
		isInitialPage
			? supabase
					.from('drive_connections')
					.select('connected_email, root_folder_id, updated_at')
					.eq('owner_id', userId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null })
	]);
	const { data, error } = radiographsResult;
	if (error) {
		console.error('Error cargando radiografias paginadas', error);
		return json({ message: 'No se pudieron cargar las radiografías.' }, { status: 500 });
	}
	if (driveResult.error) {
		console.error('Error cargando conexión Drive del paciente', driveResult.error);
	}

	const rows = data ?? [];
	const hasMore = rows.length > PAGE_SIZE;
	const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
	const last = items.at(-1);

	return json({
		items,
		has_more: hasMore,
		drive_connection: isInitialPage ? (driveResult.data ?? null) : undefined,
		next_cursor_created_at: hasMore ? last?.created_at ?? null : null,
		next_cursor_id: hasMore ? last?.id ?? null : null
	});
};
