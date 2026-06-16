// Matching del buscador en vivo de la agenda: solo nombre de paciente
// (por prefijo, insensible a mayúsculas y acentos) o teléfono (por dígitos
// contenidos, ignorando formato). No busca por servicio ni profesional.

const MIN_PHONE_DIGITS = 2;

export type AgendaSearchPatient = {
	full_name: string | null;
	phone_e164: string | null;
};

export const normalizeSearchText = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/\s+/g, ' ');

export const patientMatchesAgendaQuery = (patient: AgendaSearchPatient, rawQuery: string) => {
	const query = normalizeSearchText(rawQuery);
	if (!query) return false;

	const name = normalizeSearchText(String(patient.full_name ?? ''));
	if (name.startsWith(query)) return true;
	if (name.split(' ').some((word) => word.startsWith(query))) return true;

	const queryDigits = rawQuery.replace(/\D/g, '');
	if (queryDigits.length >= MIN_PHONE_DIGITS) {
		const phoneDigits = String(patient.phone_e164 ?? '').replace(/\D/g, '');
		if (phoneDigits.includes(queryDigits)) return true;
	}

	return false;
};
