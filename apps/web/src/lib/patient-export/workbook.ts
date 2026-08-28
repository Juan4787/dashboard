import {
	PATIENT_EXPORT_DATASETS,
	PATIENT_EXPORT_SCHEMA_VERSION,
	type PatientExportAppointmentSource,
	type PatientExportDatasetRows,
	type PatientExportSession
} from './contract';
import { assertWellFormedUnicode } from './ooxml';

export const PATIENT_EXPORT_XLSX_MIME =
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Margenes deliberados respecto de los limites documentados por Excel
// (32.767 caracteres y 253 saltos de linea por celda).
export const PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS = 30_000;
export const PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS = 250;

export const PATIENT_EXPORT_SHEET_NAMES = [
	'Informacion',
	'Pacientes',
	'Campos personalizados',
	'Historial clinico',
	'Turnos',
	'Profesionales por turno',
	'Seguimientos',
	'Textos extensos'
] as const;

export type PatientExportSheetName = (typeof PATIENT_EXPORT_SHEET_NAMES)[number];

type SheetDefinition = {
	name: PatientExportSheetName;
	headers: readonly string[];
	widths: readonly number[];
};

export const PATIENT_EXPORT_SHEET_DEFINITIONS = [
	{
		name: 'Informacion',
		headers: ['Clave', 'Valor'],
		widths: [34, 64]
	},
	{
		name: 'Pacientes',
		headers: [
			'ID paciente',
			'Nombre completo',
			'DNI',
			'Telefono',
			'Email',
			'Fecha de nacimiento',
			'Direccion',
			'Obra social',
			'Plan',
			'Alergias',
			'Medicacion',
			'Antecedentes',
			'Alerta clinica',
			'Notas clinicas',
			'Estado',
			'Archivado en',
			'Creado en',
			'Actualizado en'
		],
		widths: [38, 32, 18, 22, 30, 20, 34, 24, 20, 36, 36, 40, 36, 44, 16, 25, 25, 25]
	},
	{
		name: 'Campos personalizados',
		headers: ['ID paciente', 'Clave', 'Etiqueta', 'Tipo', 'Valor', 'Valor JSON'],
		widths: [38, 30, 30, 14, 38, 56]
	},
	{
		name: 'Historial clinico',
		headers: [
			'ID entrada clinica',
			'ID paciente',
			'Fecha y hora',
			'Tipo',
			'Descripcion',
			'Piezas',
			'Nota interna',
			'Importe',
			'ID profesional',
			'Profesional',
			'Estado',
			'Archivado en',
			'Creado en',
			'Actualizado en'
		],
		widths: [38, 38, 25, 22, 52, 18, 42, 18, 38, 30, 16, 25, 25, 25]
	},
	{
		name: 'Turnos',
		headers: [
			'ID turno',
			'ID paciente',
			'Inicio',
			'Fin',
			'Estado',
			'Origen',
			'Servicio',
			'Nota interna',
			'Profesional principal',
			'Confirmado en',
			'Cancelado en',
			'Reprogramacion solicitada en',
			'Motivo de cancelacion',
			'Creado en',
			'Actualizado en'
		],
		widths: [38, 38, 25, 25, 28, 24, 32, 42, 32, 25, 25, 30, 40, 25, 25]
	},
	{
		name: 'Profesionales por turno',
		headers: [
			'ID turno',
			'ID paciente',
			'ID profesional',
			'Profesional',
			'Es principal',
			'Orden'
		],
		widths: [38, 38, 38, 32, 16, 12]
	},
	{
		name: 'Seguimientos',
		headers: [
			'ID seguimiento',
			'ID paciente',
			'Recordar el',
			'Mensaje',
			'Estado',
			'ID profesional asignado',
			'Profesional asignado',
			'Completado en',
			'Creado en',
			'Actualizado en'
		],
		widths: [38, 38, 18, 52, 18, 38, 32, 25, 25, 25]
	},
	{
		name: 'Textos extensos',
		headers: [
			'Referencia texto',
			'Entidad',
			'ID entidad',
			'Campo',
			'Parte',
			'Total de partes',
			'Texto'
		],
		widths: [20, 28, 38, 28, 12, 16, 70]
	}
] as const satisfies readonly SheetDefinition[];

export type PatientExportWorkbookTextCell = { kind: 'text'; value: string };
export type PatientExportWorkbookNumberCell = { kind: 'number'; value: number };
export type PatientExportWorkbookCell =
	| PatientExportWorkbookTextCell
	| PatientExportWorkbookNumberCell
	| null;

export type PatientExportWorkbookSheet = {
	name: PatientExportSheetName;
	headers: readonly string[];
	widths: readonly number[];
	rows: PatientExportWorkbookCell[][];
};

export type PatientExportWorkbook = {
	filename: string;
	mimeType: typeof PATIENT_EXPORT_XLSX_MIME;
	sheets: PatientExportWorkbookSheet[];
};

export type PatientExportWorkbookInput = {
	session: PatientExportSession;
	datasets: PatientExportDatasetRows;
	generatedAtUtc: string;
};

export class PatientExportWorkbookError extends Error {
	code: 'WORKBOOK_INVALID' | 'WORKBOOK_INCOMPLETE';

	constructor(
		message = 'No pudimos construir el archivo Excel. Volvé a preparar la exportación.',
		options?: ErrorOptions & { code?: 'WORKBOOK_INVALID' | 'WORKBOOK_INCOMPLETE' }
	) {
		super(message, options);
		this.name = 'PatientExportWorkbookError';
		this.code = options?.code ?? 'WORKBOOK_INVALID';
	}
}

const text = (value: string): PatientExportWorkbookTextCell => {
	if (typeof value !== 'string') throw new PatientExportWorkbookError();
	assertWellFormedUnicode(value);
	return { kind: 'text', value };
};

const number = (value: number): PatientExportWorkbookNumberCell => {
	if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
		throw new PatientExportWorkbookError();
	}
	return { kind: 'number', value };
};

const nullableText = (value: string | null): PatientExportWorkbookTextCell | null =>
	value === null ? null : text(value);

export const splitPatientExportText = (value: string): string[] => {
	assertWellFormedUnicode(value);
	if (value.length === 0) return [''];

	const chunks: string[] = [];
	let start = 0;
	while (start < value.length) {
		let end = start;
		let lineFeeds = 0;

		while (end < value.length) {
			const codeUnit = value.charCodeAt(end);
			const codeUnitLength = codeUnit >= 0xd800 && codeUnit <= 0xdbff ? 2 : 1;
			const addsLineFeed = codeUnit === 0x0a ? 1 : 0;
			const exceedsLength = end - start + codeUnitLength > PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS;
			const exceedsLines = lineFeeds + addsLineFeed > PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS;
			if (end > start && (exceedsLength || exceedsLines)) break;
			end += codeUnitLength;
			lineFeeds += addsLineFeed;
		}

		chunks.push(value.slice(start, end));
		start = end;
	}

	return chunks;
};

type LongTextContext = {
	entity: string;
	entityId: string;
	field: string;
};

type LongTextRow = LongTextContext & {
	reference: string;
	part: number;
	totalParts: number;
	value: string;
};

const PATIENT_STATUS = { active: 'Activo', archived: 'Archivado' } as const;
const APPOINTMENT_STATUS = {
	reserved: 'Reservado',
	confirmed: 'Confirmado',
	cancelled: 'Cancelado',
	reschedule_requested: 'Reprogramación solicitada'
} as const;
const APPOINTMENT_SOURCE: Record<PatientExportAppointmentSource, string> = {
	manual: 'Carga manual',
	public_booking: 'Reserva en línea',
	whatsapp_bot: 'WhatsApp',
	admin: 'Administración'
};
const FOLLOW_UP_STATUS = { pending: 'Pendiente', done: 'Completado' } as const;

const canonicalDecimal = (value: string): string => {
	const negative = value.startsWith('-');
	const unsigned = negative ? value.slice(1) : value;
	const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
	const integer = integerPart.replace(/^0+(?=\d)/, '') || '0';
	const fraction = fractionPart.replace(/0+$/, '');
	const isZero = integer === '0' && fraction.length === 0;
	return `${negative && !isZero ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
};

/** Devuelve Number solo si el decimal conserva su representacion visible exacta. */
export const exactExcelAmount = (value: number | string | null): number | string | null => {
	if (value === null) return null;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new PatientExportWorkbookError();
		return Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : String(value);
	}
	if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value;
	const parsed = Number(value);
	if (
		!Number.isFinite(parsed) ||
		Math.abs(parsed) > Number.MAX_SAFE_INTEGER ||
		/[eE]/.test(String(parsed)) ||
		canonicalDecimal(String(parsed)) !== canonicalDecimal(value)
	) {
		return value;
	}
	return Object.is(parsed, -0) ? 0 : parsed;
};

const customFieldValue = (
	row: PatientExportDatasetRows['custom_fields'][number]
): { value: string | null; json: string | null } => {
	switch (row.value_type) {
		case 'string':
		case 'number':
			if (row.value_text === null || row.value_json !== null) throw new PatientExportWorkbookError();
			return { value: row.value_text, json: null };
		case 'boolean':
			if (
				(row.value_text !== 'true' && row.value_text !== 'false') ||
				row.value_json !== null
			) {
				throw new PatientExportWorkbookError();
			}
			return { value: row.value_text === 'true' ? 'Verdadero' : 'Falso', json: null };
		case 'null':
			if (row.value_text !== null || row.value_json !== null) throw new PatientExportWorkbookError();
			return { value: null, json: null };
		case 'object':
		case 'array': {
			if (row.value_text !== null || row.value_json === null) throw new PatientExportWorkbookError();
			try {
				const parsed = JSON.parse(row.value_json) as unknown;
				const matches =
					row.value_type === 'array'
						? Array.isArray(parsed)
						: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
				if (!matches) throw new Error('CUSTOM_FIELD_TYPE_MISMATCH');
			} catch (error) {
				throw new PatientExportWorkbookError(undefined, { cause: error });
			}
			return { value: null, json: row.value_json };
		}
	}
};

const assertWorkbookInput = (input: PatientExportWorkbookInput): Date => {
	if (
		input.session.schema_version !== PATIENT_EXPORT_SCHEMA_VERSION ||
		input.session.datasets.length !== PATIENT_EXPORT_DATASETS.length ||
		!input.session.datasets.every((dataset, index) => dataset === PATIENT_EXPORT_DATASETS[index])
	) {
		throw new PatientExportWorkbookError();
	}

	for (const dataset of PATIENT_EXPORT_DATASETS) {
		if (
			!Array.isArray(input.datasets[dataset]) ||
			input.datasets[dataset].length !== input.session.expected_counts[dataset]
		) {
			throw new PatientExportWorkbookError(
				'No pudimos comprobar que el archivo estuviera completo. Volvé a prepararlo.',
				{ code: 'WORKBOOK_INCOMPLETE' }
			);
		}
	}

	const generatedAt = new Date(input.generatedAtUtc);
	if (!Number.isFinite(generatedAt.getTime())) throw new PatientExportWorkbookError();
	return generatedAt;
};

export const patientExportFilename = (
	scope: PatientExportSession['scope'],
	generatedAt: Date
): string => {
	if (!Number.isFinite(generatedAt.getTime())) throw new PatientExportWorkbookError();
	const iso = generatedAt.toISOString();
	const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 16).replace(':', '')}`;
	return `cita-suite-${scope === 'patient' ? 'paciente' : 'pacientes'}-${stamp}.xlsx`;
};

const sheetDefinition = (name: PatientExportSheetName): SheetDefinition => {
	const definition = PATIENT_EXPORT_SHEET_DEFINITIONS.find((item) => item.name === name);
	if (!definition) throw new PatientExportWorkbookError();
	return definition;
};

const makeSheet = (
	name: PatientExportSheetName,
	rows: PatientExportWorkbookCell[][]
): PatientExportWorkbookSheet => {
	const definition = sheetDefinition(name);
	if (rows.some((row) => row.length !== definition.headers.length)) {
		throw new PatientExportWorkbookError();
	}
	return { ...definition, rows };
};

export const buildPatientExportWorkbook = (
	input: PatientExportWorkbookInput
): PatientExportWorkbook => {
	const generatedAt = assertWorkbookInput(input);
	const longTexts: LongTextRow[] = [];
	let nextTextReference = 1;

	const exportText = (
		value: string | null,
		context: LongTextContext
	): PatientExportWorkbookTextCell | null => {
		if (value === null) return null;
		const chunks = splitPatientExportText(value);
		if (chunks.length === 1) return text(value);

		const reference = `texto-${String(nextTextReference).padStart(6, '0')}`;
		nextTextReference += 1;
		for (let index = 0; index < chunks.length; index += 1) {
			longTexts.push({
				...context,
				reference,
				part: index + 1,
				totalParts: chunks.length,
				value: chunks[index] ?? ''
			});
		}
		return text(reference);
	};

	const informationRows: PatientExportWorkbookCell[][] = [
		['version_formato', PATIENT_EXPORT_SCHEMA_VERSION],
		['generado_en_utc', generatedAt.toISOString()],
		['timezone_consultorio', input.session.business.timezone],
		[
			'alcance',
			input.session.scope === 'patient' ? 'Paciente individual' : 'Todos los pacientes'
		],
		['consultorio', input.session.business.name],
		['cantidad_pacientes', input.datasets.patients.length],
		['cantidad_campos_personalizados', input.datasets.custom_fields.length],
		['cantidad_entradas_clinicas', input.datasets.clinical_entries.length],
		['cantidad_turnos', input.datasets.appointments.length],
		['cantidad_relaciones_profesionales', input.datasets.appointment_professionals.length],
		['cantidad_seguimientos', input.datasets.follow_ups.length],
		['incluye_radiografias', 'No'],
		['incluye_adjuntos', 'No'],
		[
			'aclaracion',
			'Incluye datos tabulares. No incluye radiografias, imagenes, PDF ni archivos adjuntos.'
		]
	].map(([key, value]) => [
		text(String(key)),
		typeof value === 'number'
			? number(value)
			: exportText(String(value), {
					entity: 'Informacion',
					entityId: 'workbook',
					field: String(key)
				})
	]);

	const patientRows = input.datasets.patients.map((row) => {
		const context = (field: string): LongTextContext => ({
			entity: 'Paciente',
			entityId: row.patient_id,
			field
		});
		return [
			exportText(row.patient_id, context('ID paciente')),
			exportText(row.full_name, context('Nombre completo')),
			exportText(row.dni, context('DNI')),
			exportText(row.phone, context('Telefono')),
			exportText(row.email, context('Email')),
			exportText(row.birth_date, context('Fecha de nacimiento')),
			exportText(row.address, context('Direccion')),
			exportText(row.insurance, context('Obra social')),
			exportText(row.insurance_plan, context('Plan')),
			exportText(row.allergies, context('Alergias')),
			exportText(row.medication, context('Medicacion')),
			exportText(row.background, context('Antecedentes')),
			exportText(row.clinical_alert_note, context('Alerta clinica')),
			exportText(row.clinical_notes, context('Notas clinicas')),
			text(PATIENT_STATUS[row.status]),
			nullableText(row.archived_at),
			text(row.created_at),
			text(row.updated_at)
		];
	});

	const customFieldRows = input.datasets.custom_fields.map((row) => {
		const values = customFieldValue(row);
		const context = (field: string): LongTextContext => ({
			entity: 'Campo personalizado',
			entityId: row.patient_id,
			field
		});
		return [
			text(row.patient_id),
			exportText(row.field_key, context('Clave')),
			exportText(row.field_label, context('Etiqueta')),
			text(row.value_type),
			exportText(values.value, context('Valor')),
			exportText(values.json, context('Valor JSON'))
		];
	});

	const clinicalEntryRows = input.datasets.clinical_entries.map((row) => {
		const context = (field: string): LongTextContext => ({
			entity: 'Entrada clinica',
			entityId: row.clinical_entry_id,
			field
		});
		const amount = exactExcelAmount(row.amount);
		const amountCell =
			amount === null
				? null
				: typeof amount === 'number'
					? number(amount)
					: exportText(amount, context('Importe'));
		return [
			text(row.clinical_entry_id),
			text(row.patient_id),
			text(row.occurred_at),
			exportText(row.entry_type, context('Tipo')),
			exportText(row.description, context('Descripcion')),
			exportText(row.teeth, context('Piezas')),
			exportText(row.internal_note, context('Nota interna')),
			amountCell,
			nullableText(row.professional_id),
			exportText(row.professional_name, context('Profesional')),
			text(PATIENT_STATUS[row.status]),
			nullableText(row.archived_at),
			text(row.created_at),
			text(row.updated_at)
		];
	});

	const appointmentRows = input.datasets.appointments.map((row) => {
		const context = (field: string): LongTextContext => ({
			entity: 'Turno',
			entityId: row.appointment_id,
			field
		});
		return [
			text(row.appointment_id),
			text(row.patient_id),
			text(row.starts_at),
			text(row.ends_at),
			text(APPOINTMENT_STATUS[row.status]),
			text(APPOINTMENT_SOURCE[row.source]),
			exportText(row.service_name_snapshot, context('Servicio')),
			exportText(row.internal_note, context('Nota interna')),
			exportText(row.professional_name_snapshot, context('Profesional principal')),
			nullableText(row.confirmed_at),
			nullableText(row.cancelled_at),
			nullableText(row.reschedule_requested_at),
			exportText(row.cancelled_reason, context('Motivo de cancelacion')),
			text(row.created_at),
			text(row.updated_at)
		];
	});

	const appointmentProfessionalRows = input.datasets.appointment_professionals.map((row) => [
		text(row.appointment_id),
		text(row.patient_id),
		text(row.professional_id),
		exportText(row.professional_name, {
			entity: 'Profesional por turno',
			entityId: row.appointment_id,
			field: 'Profesional'
		}),
		text(row.is_primary ? 'Sí' : 'No'),
		number(row.position)
	]);

	const followUpRows = input.datasets.follow_ups.map((row) => {
		const context = (field: string): LongTextContext => ({
			entity: 'Seguimiento',
			entityId: row.follow_up_id,
			field
		});
		return [
			text(row.follow_up_id),
			text(row.patient_id),
			text(row.remind_on),
			exportText(row.message, context('Mensaje')),
			text(FOLLOW_UP_STATUS[row.status]),
			nullableText(row.assigned_professional_id),
			exportText(row.assigned_professional_name, context('Profesional asignado')),
			nullableText(row.done_at),
			text(row.created_at),
			text(row.updated_at)
		];
	});

	const longTextRows = longTexts.map((row) => [
		text(row.reference),
		text(row.entity),
		text(row.entityId),
		text(row.field),
		number(row.part),
		number(row.totalParts),
		text(row.value)
	]);

	return {
		filename: patientExportFilename(input.session.scope, generatedAt),
		mimeType: PATIENT_EXPORT_XLSX_MIME,
		sheets: [
			makeSheet('Informacion', informationRows),
			makeSheet('Pacientes', patientRows),
			makeSheet('Campos personalizados', customFieldRows),
			makeSheet('Historial clinico', clinicalEntryRows),
			makeSheet('Turnos', appointmentRows),
			makeSheet('Profesionales por turno', appointmentProfessionalRows),
			makeSheet('Seguimientos', followUpRows),
			makeSheet('Textos extensos', longTextRows)
		]
	};
};
