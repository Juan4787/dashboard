import { describe, expect, it } from 'vitest';
import type { PatientExportDatasetRows } from './contract';
import { PatientExportTextError } from './ooxml';
import {
	PATIENT_EXPORT_SHEET_DEFINITIONS,
	PATIENT_EXPORT_SHEET_NAMES,
	PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS,
	PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS,
	PATIENT_EXPORT_XLSX_MIME,
	PatientExportWorkbookError,
	buildPatientExportWorkbook,
	exactExcelAmount,
	splitPatientExportText,
	type PatientExportWorkbookCell
} from './workbook';
import {
	makePatientExportWorkbookInput,
	sessionForDatasets
} from './test-fixtures';

const valueOf = (cell: PatientExportWorkbookCell): string | number | null => cell?.value ?? null;

const emptyDatasets = (): PatientExportDatasetRows => ({
	patients: [],
	custom_fields: [],
	clinical_entries: [],
	appointments: [],
	appointment_professionals: [],
	follow_ups: []
});

describe('patient export workbook v1', () => {
	it('keeps the exact eight-sheet contract and headers, including empty sheets', () => {
		const datasets = emptyDatasets();
		const workbook = buildPatientExportWorkbook({
			session: sessionForDatasets(datasets),
			datasets,
			generatedAtUtc: '2026-08-28T14:35:00.000Z'
		});

		expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
			'Informacion',
			'Pacientes',
			'Campos personalizados',
			'Historial clinico',
			'Turnos',
			'Profesionales por turno',
			'Seguimientos',
			'Textos extensos'
		]);
		expect(PATIENT_EXPORT_SHEET_NAMES).toHaveLength(8);
		expect(PATIENT_EXPORT_SHEET_DEFINITIONS.map(({ headers }) => headers)).toEqual([
			['Clave', 'Valor'],
			[
				'ID paciente', 'Nombre completo', 'DNI', 'Telefono', 'Email',
				'Fecha de nacimiento', 'Direccion', 'Obra social', 'Plan', 'Alergias',
				'Medicacion', 'Antecedentes', 'Alerta clinica', 'Notas clinicas', 'Estado',
				'Archivado en', 'Creado en', 'Actualizado en'
			],
			['ID paciente', 'Clave', 'Etiqueta', 'Tipo', 'Valor', 'Valor JSON'],
			[
				'ID entrada clinica', 'ID paciente', 'Fecha y hora', 'Tipo', 'Descripcion',
				'Piezas', 'Nota interna', 'Importe', 'ID profesional', 'Profesional', 'Estado',
				'Archivado en', 'Creado en', 'Actualizado en'
			],
			[
				'ID turno', 'ID paciente', 'Inicio', 'Fin', 'Estado', 'Origen', 'Servicio',
				'Nota interna', 'Profesional principal', 'Confirmado en', 'Cancelado en',
				'Reprogramacion solicitada en', 'Motivo de cancelacion', 'Creado en', 'Actualizado en'
			],
			['ID turno', 'ID paciente', 'ID profesional', 'Profesional', 'Es principal', 'Orden'],
			[
				'ID seguimiento', 'ID paciente', 'Recordar el', 'Mensaje', 'Estado',
				'ID profesional asignado', 'Profesional asignado', 'Completado en',
				'Creado en', 'Actualizado en'
			],
			['Referencia texto', 'Entidad', 'ID entidad', 'Campo', 'Parte', 'Total de partes', 'Texto']
		]);
		expect(workbook.sheets.slice(1).every((sheet) => sheet.rows.length === 0)).toBe(true);
		expect(workbook.filename).toBe('cita-suite-pacientes-20260828-1435.xlsx');
		expect(workbook.mimeType).toBe(PATIENT_EXPORT_XLSX_MIME);
	});

	it('maps states and origins to human text while preserving IDs and scalar types', () => {
		const workbook = buildPatientExportWorkbook(makePatientExportWorkbookInput());
		const byName = new Map(workbook.sheets.map((sheet) => [sheet.name, sheet]));
		const patient = byName.get('Pacientes')?.rows[0];
		const clinical = byName.get('Historial clinico')?.rows[0];
		const appointment = byName.get('Turnos')?.rows[0];
		const professional = byName.get('Profesionales por turno')?.rows[0];
		const followUp = byName.get('Seguimientos')?.rows[0];

		expect(patient?.map(valueOf).slice(0, 6)).toEqual([
			'11111111-1111-4111-8111-111111111111',
			'Zoë Núñez 😀',
			'00123456',
			'+54 11 4000-0000',
			'zoe@example.test',
			'1990-01-02'
		]);
		expect(valueOf(patient?.[14] ?? null)).toBe('Activo');
		expect(valueOf(clinical?.[7] ?? null)).toBe(12345.67);
		expect(clinical?.[7]?.kind).toBe('number');
		expect(valueOf(clinical?.[10] ?? null)).toBe('Archivado');
		expect(valueOf(appointment?.[4] ?? null)).toBe('Reprogramación solicitada');
		expect(valueOf(appointment?.[5] ?? null)).toBe('Reserva en línea');
		expect(valueOf(professional?.[4] ?? null)).toBe('Sí');
		expect(valueOf(professional?.[5] ?? null)).toBe(0);
		expect(valueOf(followUp?.[4] ?? null)).toBe('Completado');
	});

	it('keeps every custom-field root type reconstructible', () => {
		const customRows = buildPatientExportWorkbook(makePatientExportWorkbookInput()).sheets.find(
			(sheet) => sheet.name === 'Campos personalizados'
		)?.rows;
		expect(customRows?.map((row) => row.map(valueOf).slice(3))).toEqual([
			['string', '=1+1', null],
			['number', '9007199254740993', null],
			['boolean', 'Verdadero', null],
			['null', null, null],
			['object', null, '{"a":1,"b":"001"}'],
			['array', null, '[1,"001",false]']
		]);
	});

	it('moves oversized text to reversible chunks without cutting surrogate pairs', () => {
		const input = makePatientExportWorkbookInput();
		const original = `${'a'.repeat(29_999)}😀${'b'.repeat(4_000)}${'\n'.repeat(301)}fin`;
		input.datasets.clinical_entries[0]!.description = original;

		const workbook = buildPatientExportWorkbook(input);
		const clinicalRow = workbook.sheets.find((sheet) => sheet.name === 'Historial clinico')!
			.rows[0]!;
		const reference = valueOf(clinicalRow[4] ?? null);
		const parts = workbook.sheets
			.find((sheet) => sheet.name === 'Textos extensos')!
			.rows.filter((row) => valueOf(row[0] ?? null) === reference)
			.sort((left, right) => Number(valueOf(left[4] ?? null)) - Number(valueOf(right[4] ?? null)));
		const chunks = parts.map((row) => String(valueOf(row[6] ?? null)));

		expect(reference).toBe('texto-000001');
		expect(chunks.join('')).toBe(original);
		expect(chunks.every((chunk) => chunk.length <= PATIENT_EXPORT_TEXT_CHUNK_CODE_UNITS)).toBe(true);
		expect(
			chunks.every(
				(chunk) => (chunk.match(/\n/g) ?? []).length <= PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS
			)
		).toBe(true);
		expect(chunks.some((chunk) => chunk.startsWith('😀'))).toBe(true);
		expect(parts.every((row) => valueOf(row[5] ?? null) === parts.length)).toBe(true);
	});

	it('uses numbers only when decimal text round-trips safely', () => {
		expect(exactExcelAmount('00123.4500')).toBe(123.45);
		expect(exactExcelAmount('9007199254740991')).toBe(9007199254740991);
		expect(exactExcelAmount('9007199254740993')).toBe('9007199254740993');
		expect(exactExcelAmount('1.0000000000000001')).toBe('1.0000000000000001');
		expect(exactExcelAmount('0.0000001')).toBe('0.0000001');
		expect(exactExcelAmount('-0.00')).toBe(0);
	});

	it('fails closed on count mismatch, malformed custom JSON and malformed Unicode', () => {
		const mismatched = makePatientExportWorkbookInput();
		mismatched.session.expected_counts.patients += 1;
		expect(() => buildPatientExportWorkbook(mismatched)).toThrow(
			expect.objectContaining({ code: 'WORKBOOK_INCOMPLETE' })
		);

		const malformedJson = makePatientExportWorkbookInput();
		malformedJson.datasets.custom_fields[4]!.value_json = '[]';
		expect(() => buildPatientExportWorkbook(malformedJson)).toThrow(PatientExportWorkbookError);

		const malformedUnicode = makePatientExportWorkbookInput();
		malformedUnicode.datasets.patients[0]!.full_name = '\ud800';
		expect(() => buildPatientExportWorkbook(malformedUnicode)).toThrow(PatientExportTextError);
	});

	it('splits solely on line-feed limits when character length is small', () => {
		const original = 'x\n'.repeat(PATIENT_EXPORT_TEXT_CHUNK_LINE_FEEDS + 2);
		const chunks = splitPatientExportText(original);
		expect(chunks.length).toBe(2);
		expect(chunks.join('')).toBe(original);
	});
});
