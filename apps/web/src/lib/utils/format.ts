// Sin timeZone, Intl usa la zona del runtime: en SSR (Netlify) eso es UTC y difiere
// del navegador del paciente. Toda superficie pública debe pasar la timezone del negocio.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (
	cache: Map<string, Intl.DateTimeFormat>,
	options: Intl.DateTimeFormatOptions,
	timeZone?: string
) => {
	const key = timeZone ?? '';
	let formatter = cache.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('es-AR', timeZone ? { ...options, timeZone } : options);
		cache.set(key, formatter);
	}
	return formatter;
};

export const formatDate = (value?: string | null, timeZone?: string) => {
	if (!value) return '';
	return formatterFor(
		dateFormatters,
		{ day: 'numeric', month: 'long', year: 'numeric' },
		timeZone
	).format(new Date(value));
};

export const formatDateTime = (value?: string | null, timeZone?: string) => {
	if (!value) return '';
	return formatterFor(
		dateTimeFormatters,
		{
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		},
		timeZone
	).format(new Date(value));
};

export type ZonedDateTimeLabels = {
	dateLabel: string;
	timeLabel: string;
	full: string;
};

export const formatInTimeZone = (value: string | Date, timeZone: string): ZonedDateTimeLabels => {
	const date = typeof value === 'string' ? new Date(value) : value;
	const dateLabel = formatterFor(
		dayFormatters,
		{ weekday: 'long', day: '2-digit', month: 'long' },
		timeZone
	).format(date);
	const timeLabel = formatterFor(
		timeFormatters,
		{ hour: '2-digit', minute: '2-digit', hour12: false },
		timeZone
	).format(date);
	return { dateLabel, timeLabel, full: `${dateLabel} a las ${timeLabel}` };
};

export const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
