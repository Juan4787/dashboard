export const normalizePhoneE164 = (value?: string | null) => {
	const digits = String(value ?? '').replace(/\D/g, '');
	if (!digits) return null;
	if (digits.startsWith('00')) return `+${digits.slice(2)}`;
	if (digits.startsWith('549')) return `+${digits}`;
	if (digits.startsWith('54')) return `+549${digits.slice(2)}`;
	if (digits.length === 10) return `+549${digits}`;
	return `+${digits}`;
};

export const normalizePhoneRaw = (value?: string | null) => {
	const trimmed = String(value ?? '').trim();
	return trimmed || null;
};

export const isLikelyPhoneE164 = (value?: string | null) => {
	const normalized = normalizePhoneE164(value);
	if (!normalized) return false;
	const digits = normalized.replace(/\D/g, '');
	return digits.length >= 8 && digits.length <= 15;
};

// WhatsApp exige el número internacional sin prefijos de marcación local. Para
// móviles argentinos la forma canónica es +54 9 + los diez dígitos nacionales.
// ENACOM indica que esos diez dígitos no incluyen ni el 0 interurbano ni el 15
// usado al marcar localmente. Esta función es deliberadamente más estricta que
// normalizePhoneE164: si no puede reconstruir los diez dígitos sin adivinar, no
// genera un destinatario.
const isArgentineNationalNumber = (digits: string) =>
	/^\d{10}$/.test(digits) && (digits.startsWith('11') || /^[23]/.test(digits));

const normalizeArgentineNationalNumber = (rawDigits: string): string | null => {
	const digits = rawDigits.startsWith('0') ? rawDigits.slice(1) : rawDigits;
	if (isArgentineNationalNumber(digits)) return digits;

	// En formato local el 15 se inserta entre el código de área y el abonado.
	// Buenos Aires usa 11 (dos dígitos); el resto de los indicativos geográficos
	// argentinos usa aquí una longitud posible de tres o cuatro dígitos. Si más de
	// una eliminación fuese válida, fallamos de forma segura en vez de elegir una.
	if (digits.length !== 12) return null;
	const areaCodeLengths = digits.startsWith('11')
		? [2]
		: /^[23]/.test(digits)
			? [3, 4]
			: [];
	const candidates = [
		...new Set(
			areaCodeLengths
				.filter((areaLength) => digits.slice(areaLength, areaLength + 2) === '15')
				.map((areaLength) => digits.slice(0, areaLength) + digits.slice(areaLength + 2))
				.filter(isArgentineNationalNumber)
		)
	];
	return candidates.length === 1 ? candidates[0] : null;
};

export const normalizeArgentineWhatsAppPhone = (value?: string | null): string | null => {
	let digits = String(value ?? '').replace(/\D/g, '');
	if (!digits) return null;
	if (digits.startsWith('00')) digits = digits.slice(2);

	let national: string | null;
	if (digits.startsWith('549')) {
		national = isArgentineNationalNumber(digits.slice(3)) ? digits.slice(3) : null;
	} else if (digits.startsWith('54')) {
		national = normalizeArgentineNationalNumber(digits.slice(2));
	} else {
		// También recupera valores argentinos que el normalizador legado pudo dejar
		// como +0... o +35115... al recibir un 0/15 local.
		national = normalizeArgentineNationalNumber(digits);
	}

	return national ? `+549${national}` : null;
};
