'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadTranslations, formatTable } = require('../../scripts/download-translations.cjs');

function tempDir(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'download-translations-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

const catalog = (lang, text) => ({ locale_data: { messages: { '': { lang }, 'No sites yet.': [text] } } });

// A stand-in for translate.wordpress.org: the project API, and one export per locale.
function fakeFetch(routes) {
	const calls = [];
	const fetch = async (url) => {
		calls.push(url);
		const body = routes[url];
		if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
		if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) };
		return { ok: true, status: 200, json: async () => body };
	};
	return { fetch, calls };
}

const API = 'https://translate.wordpress.org/api/projects/meta/contributor-toolkit/';
const exportUrl = (locale) => `https://translate.wordpress.org/projects/meta/contributor-toolkit/${locale}/default/export-translations/?format=jed1x`;

const SETS = {
	translation_sets: [
		{ locale: 'de', percent_translated: 100, current_count: 26 },
		{ locale: 'pt-br', percent_translated: 80, current_count: 21 },
		{ locale: 'fr', percent_translated: 79, current_count: 20 },
		{ locale: 'ja', percent_translated: 0, current_count: 0 }
	]
};

test('writes each locale at or above the cut-off, and only those', async (t) => {
	const dir = tempDir(t);
	const { fetch, calls } = fakeFetch({
		[API]: SETS,
		[exportUrl('de')]: catalog('de', 'Noch keine Websites.'),
		[exportUrl('pt-br')]: catalog('pt-br', 'Nenhum site ainda.')
	});

	const result = await downloadTranslations({ dir, fetch });

	assert.deepEqual(result.shipped.map((row) => row.locale), ['de', 'pt-br']);
	assert.deepEqual(fs.readdirSync(dir).sort(), ['de.json', 'pt-br.json']);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'de.json'), 'utf8')).locale_data.messages['No sites yet.'], ['Noch keine Websites.']);
	// Nothing is asked for below the cut-off.
	assert.ok(!calls.includes(exportUrl('fr')));
});

test('removes the catalog of a locale that fell below the cut-off, and leaves other files alone', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'fr.json'), '{}');
	fs.writeFileSync(path.join(dir, 'README.md'), 'kept');
	const { fetch } = fakeFetch({
		[API]: SETS,
		[exportUrl('de')]: catalog('de', 'x'),
		[exportUrl('pt-br')]: catalog('pt-br', 'x')
	});

	const result = await downloadTranslations({ dir, fetch });

	assert.deepEqual(result.removed, ['fr']);
	assert.deepEqual(fs.readdirSync(dir).sort(), ['README.md', 'de.json', 'pt-br.json']);
});

test('a failed export changes nothing in the catalog directory', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'de.json'), 'the old catalog');
	const { fetch } = fakeFetch({
		[API]: SETS,
		[exportUrl('de')]: catalog('de', 'new'),
		[exportUrl('pt-br')]: 500
	});

	await assert.rejects(downloadTranslations({ dir, fetch }), /500 from .*pt-br/);
	assert.deepEqual(fs.readdirSync(dir), ['de.json']);
	assert.equal(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'), 'the old catalog');
});

test('a project translate.wordpress.org does not have yet is named as such', async (t) => {
	const { fetch } = fakeFetch({});
	await assert.rejects(downloadTranslations({ dir: tempDir(t), fetch }), /has no project meta\/contributor-toolkit yet/);
});

test('an export without locale_data is refused rather than shipped', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'de', percent_translated: 100, current_count: 1 }] },
		[exportUrl('de')]: { error: 'not a catalog' }
	});
	await assert.rejects(downloadTranslations({ dir, fetch }), /de export has no locale_data/);
	assert.deepEqual(fs.readdirSync(dir), []);
});

test('a locale slug that could name a path is refused', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({ [API]: { translation_sets: [{ locale: '../evil', percent_translated: 100, current_count: 1 }] } });
	await assert.rejects(downloadTranslations({ dir, fetch }), /Refusing the locale slug/);
	assert.deepEqual(fs.readdirSync(dir), []);
});

test('the table lists each locale and names the ones removed', () => {
	const table = formatTable({ shipped: [{ locale: 'de', percent: 100, strings: 26 }], removed: ['fr'] });
	assert.match(table, /\| de \| 100% \| 26 \|/);
	assert.match(table, /Removed, below 80%: fr/);
});
