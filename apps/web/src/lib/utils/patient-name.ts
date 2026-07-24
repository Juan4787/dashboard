export const PATIENT_FULL_NAME_ERROR_MESSAGE = 'Ingresá tu nombre y apellido para reservar.';

const VALID_NAME_PART = /^[\p{L}\p{M}]+(?:['’\-][\p{L}\p{M}]+)*$/u;

/**
 * Keeps the patient's spelling while removing whitespace differences that
 * should never create separate identities or be persisted in the record.
 */
export const normalizePatientFullName = (value: string) =>
	value.normalize('NFC').trim().replace(/\s+/gu, ' ');

/**
 * Public bookings require at least a given name and a surname. Each part must
 * be a real word with at least two letters; apostrophes and hyphens are allowed
 * inside a word so names such as O'Connor and Pérez-Gómez remain valid.
 */
export const isValidPatientFullName = (value: string) => {
	const parts = normalizePatientFullName(value).split(' ').filter(Boolean);
	return (
		parts.length >= 2 &&
		parts.every(
			(part) => VALID_NAME_PART.test(part) && (part.match(/\p{L}/gu)?.length ?? 0) >= 2
		)
	);
};

/**
 * Mirrors the database comparison used by the public-booking capacity rule.
 * Spanish vowel accents are ignored, but ñ remains distinct from n because it
 * is a different letter (Peña and Pena must not be merged).
 */
export const normalizePatientNameForComparison = (value: string) =>
	normalizePatientFullName(value)
		.toLocaleLowerCase('es-AR')
		.replace(/[áàâäãå]/g, 'a')
		.replace(/[éèêë]/g, 'e')
		.replace(/[íìîï]/g, 'i')
		.replace(/[óòôöõ]/g, 'o')
		.replace(/[úùûü]/g, 'u')
		.replace(/[ýÿ]/g, 'y');
