export type PatientStatus = 'activo' | 'archivado';

export type ClinicalEntryType =
	| 'Consulta'
	| 'Diagnóstico'
	| 'Tratamiento'
	| 'Procedimiento'
	| 'Evolución'
	| 'Indicaciones'
	| 'Nota interna';

export interface Patient {
	id: string;
	full_name: string;
	dni?: string | null;
	phone?: string | null;
	email?: string | null;
	birth_date?: string | null;
	address?: string | null;
	allergies?: string | null;
	medication?: string | null;
	background?: string | null;
	insurance?: string | null;
	insurance_plan?: string | null;
	custom_fields?: Record<string, unknown> | null;
	drive_folder_id?: string | null;
	archived_at?: string | null;
	last_entry_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

export interface ClinicalEntry {
	id: string;
	patient_id: string;
	created_at: string;
	entry_type: ClinicalEntryType;
	description: string;
	teeth?: string | null;
	amount?: number | null;
	internal_note?: string | null;
}

export type RadiographStatus = 'uploading' | 'ready' | 'failed';

export interface PatientRadiograph {
	id: string;
	patient_id: string;
	status?: RadiographStatus | null;
	drive_file_id?: string | null;
	original_filename?: string | null;
	mime_type?: string | null;
	bytes?: number | null;
	sha256?: string | null;
	taken_at?: string | null;
	note?: string | null;
	created_at?: string | null;
	created_by?: string | null;
	deleted_at?: string | null;
}

export type PersonStatus = 'activo' | 'archivado';

export interface Person {
	id: string;
	full_name: string;
	dni?: string | null;
	phone?: string | null;
	email?: string | null;
	archived_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
}

export type CaseStatus =
	| 'Nuevo'
	| 'En curso'
	| 'Pendiente docs'
	| 'Presentado'
	| 'Resuelto'
	| 'Cerrado';

export interface CaseFile {
	id: string;
	person_id: string;
	person_name?: string | null;
	person_dni?: string | null;
	title: string;
	status: CaseStatus;
	notes?: string | null;
	next_action?: string | null;
	next_action_date?: string | null;
	archived_at?: string | null;
	created_at?: string | null;
	updated_at?: string | null;
	person?: Person;
}

export type CaseEventType =
	| 'Llamada'
	| 'Presentación'
	| 'Rechazo'
	| 'Requerimiento'
	| 'Envío docs'
	| 'Visita'
	| 'Nota';

export interface CaseEvent {
	id: string;
	case_id: string;
	created_at: string;
	event_type: CaseEventType;
	detail: string;
}
