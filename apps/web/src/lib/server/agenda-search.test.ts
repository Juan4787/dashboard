import { describe, expect, it } from 'vitest';
import { normalizeSearchText, patientMatchesAgendaQuery } from './agenda-search';

describe('normalizeSearchText', () => {
	it('lowercases, trims, strips diacritics and collapses spaces', () => {
		expect(normalizeSearchText('  María   JOSÉ ')).toBe('maria jose');
		expect(normalizeSearchText('Ñandú')).toBe('nandu');
	});
});

describe('patientMatchesAgendaQuery', () => {
	const patient = { full_name: 'María José Pérez', phone_e164: '+5493515551234' };

	it('matches names by prefix from the first character', () => {
		expect(patientMatchesAgendaQuery(patient, 'M')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'mar')).toBe(true);
		expect(patientMatchesAgendaQuery({ full_name: 'Pedro', phone_e164: null }, 'M')).toBe(false);
	});

	it('ignores case and accents in both directions', () => {
		expect(patientMatchesAgendaQuery(patient, 'maría')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'maria')).toBe(true);
		expect(patientMatchesAgendaQuery({ full_name: 'Maria', phone_e164: null }, 'marí')).toBe(true);
	});

	it('matches any word of the name by prefix', () => {
		expect(patientMatchesAgendaQuery(patient, 'jose')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'perez')).toBe(true);
	});

	it('matches multi-word prefixes of the full name', () => {
		expect(patientMatchesAgendaQuery(patient, 'maria jo')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'jose maria')).toBe(false);
	});

	it('does not match fragments in the middle of a word', () => {
		expect(patientMatchesAgendaQuery(patient, 'aria')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, 'rez')).toBe(false);
	});

	it('matches phones by contained digits ignoring formatting', () => {
		expect(patientMatchesAgendaQuery(patient, '3515551234')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '555 1234')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '351-555')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '999999')).toBe(false);
	});

	it('requires at least two digits before matching phones', () => {
		expect(patientMatchesAgendaQuery(patient, '5')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, '55')).toBe(true);
	});

	it('handles empty queries and null fields safely', () => {
		expect(patientMatchesAgendaQuery(patient, '')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, '   ')).toBe(false);
		expect(patientMatchesAgendaQuery({ full_name: null, phone_e164: null }, 'ana')).toBe(false);
	});
});
