import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readPeer = (relativePath: string) =>
	readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('patient migration contracts', () => {
	it('does not read clinical entry amount directly from clinical_entries in patient history endpoints', () => {
		const detailSource = readPeer('./+page.server.ts');
		const historySource = readPeer('./historial/+server.ts');
		const directAmountSelect = /from\('clinical_entries'\)[\s\S]{0,240}\.select\('[^']*\bamount\b/;

		expect(detailSource).not.toMatch(directAmountSelect);
		expect(historySource).not.toMatch(directAmountSelect);
	});

	it('does not archive, unarchive, or delete patients through direct table writes', () => {
		const detailSource = readPeer('./+page.server.ts');

		expect(detailSource).not.toMatch(/from\('patients'\)[\s\S]{0,160}\.delete\(/);
		expect(detailSource).not.toMatch(/from\('patients'\)[\s\S]{0,240}\.update\(\{[^}]*archived_at/);
	});

	it('does not create or update clinical entries through direct route table writes', () => {
		const detailSource = readPeer('./+page.server.ts');

		expect(detailSource).not.toMatch(/from\('clinical_entries'\)[\s\S]{0,120}\.insert\(/);
		expect(detailSource).not.toMatch(/from\('clinical_entries'\)[\s\S]{0,120}\.update\(/);
		expect(detailSource).toContain("rpc('create_clinical_entry_safely'");
		expect(detailSource).toContain("rpc('update_clinical_entry_safely'");
	});
});
