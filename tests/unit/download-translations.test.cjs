'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadTranslations, formatTable, parseArgs } = require('../../scripts/download-translations.cjs');

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
		{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 26 },
		{ locale: 'pt-br', slug: 'default', percent_translated: 80, current_count: 21 },
		{ locale: 'fr', slug: 'default', percent_translated: 79, current_count: 20 },
		{ locale: 'ja', slug: 'default', percent_translated: 0, current_count: 0 }
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

test('uses the full project path without adding a meta prefix', async (t) => {
	const dir = tempDir(t);
	const project = 'plugins/example/stable';
	const api = `https://translate.wordpress.org/api/projects/${project}/`;
	const url = `https://translate.wordpress.org/projects/${project}/de/default/export-translations/?format=jed1x&filters[status]=current_or_waiting`;
	const { fetch, calls } = fakeFetch({
		[api]: { translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 0, current_count: 0, waiting_count: 10, all_count: 10 }] },
		[url]: catalog('de', 'x')
	});
	await downloadTranslations({ project, dir, fetch, status: ['current', 'waiting'] });
	assert.deepEqual(calls, [api, url]);
	assert.deepEqual(fs.readdirSync(dir), ['de.json']);
});

test('explicit statuses export waiting strings below the default cut-off', async (t) => {
	const dir = tempDir(t);
	const waitingUrl = `${exportUrl('de')}&filters[status]=current_or_waiting`;
	const { fetch, calls } = fakeFetch({
		[API]: { translation_sets: [
			{ locale: 'de', slug: 'default', percent_translated: 20, current_count: 2, waiting_count: 6, all_count: 10 },
			{ locale: 'fr', slug: 'default', percent_translated: 20, current_count: 2, waiting_count: 5, all_count: 10 }
		] },
		[waitingUrl]: catalog('de', 'Waiting translation'),
		[`${exportUrl('fr')}&filters[status]=current_or_waiting`]: catalog('fr', 'waiting')
	});

	const approvedOnly = await downloadTranslations({ dir, fetch });
	assert.deepEqual(approvedOnly.shipped, []);
	const result = await downloadTranslations({ dir, fetch, status: ['current', 'waiting'] });
	assert.deepEqual(result.shipped, [{ locale: 'de', percent: 80, strings: 8, selectable: true }, { locale: 'fr', percent: 70, strings: 7, selectable: true }]);
	assert.deepEqual(fs.readdirSync(dir).sort(), ['de.json', 'fr.json']);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'de.json'), 'utf8')).locale_data.messages['No sites yet.'], ['Waiting translation']);
	assert.ok(calls.includes(waitingUrl));
	assert.ok(calls.includes(`${exportUrl('fr')}&filters[status]=current_or_waiting`));
});

test('including waiting refuses missing counts without removing existing catalogs', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'de.json'), 'old catalog');
	const { fetch } = fakeFetch({ [API]: SETS });
	await assert.rejects(downloadTranslations({ dir, fetch, status: ['current', 'waiting'] }), /without valid translation counts/);
	assert.equal(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'), 'old catalog');
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

test('a variant such as German (formal) is not read as the locale it varies', async (t) => {
	// The export is always the default set's, so a variant's percentage must not
	// decide whether de.json ships, nor list de twice.
	const dir = tempDir(t);
	const { fetch, calls } = fakeFetch({
		[API]: {
			translation_sets: [
				{ locale: 'de', slug: 'default', percent_translated: 40, current_count: 10 },
				{ locale: 'de', slug: 'formal', percent_translated: 100, current_count: 26 },
				{ locale: 'pt', slug: 'default', percent_translated: 100, current_count: 26 },
				{ locale: 'pt', slug: 'ao90', percent_translated: 100, current_count: 26 }
			]
		},
		[exportUrl('pt')]: catalog('pt', 'x')
	});

	const result = await downloadTranslations({ dir, fetch });

	assert.deepEqual(result.shipped.map((row) => row.locale), ['pt']);
	assert.deepEqual(fs.readdirSync(dir), ['pt.json']);
	assert.ok(!calls.includes(exportUrl('de')));
	assert.equal(calls.filter((url) => url === exportUrl('pt')).length, 1);
});

test('a translation set without a slug is refused rather than skipped', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'de.json'), 'the old catalog');
	const { fetch } = fakeFetch({ [API]: { translation_sets: [{ locale: 'de', percent_translated: 100, current_count: 1 }] } });
	await assert.rejects(downloadTranslations({ dir, fetch }), /in a shape this script does not know/);
	assert.deepEqual(fs.readdirSync(dir), ['de.json']);
});

test('a project translate.wordpress.org does not have yet is named as such', async (t) => {
	const { fetch } = fakeFetch({});
	await assert.rejects(downloadTranslations({ dir: tempDir(t), fetch }), /has no project meta\/contributor-toolkit yet/);
});

test('an export without locale_data is refused rather than shipped', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 1 }] },
		[exportUrl('de')]: { error: 'not a catalog' }
	});
	await assert.rejects(downloadTranslations({ dir, fetch }), /de export has no locale_data/);
	assert.deepEqual(fs.readdirSync(dir), []);
});

test('an export whose messages the app cannot read leaves the existing catalog alone', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'de.json'), 'the old catalog');
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 1 }] },
		[exportUrl('de')]: { locale_data: { messages: [] } }
	});
	await assert.rejects(downloadTranslations({ dir, fetch }), /de export has no locale_data/);
	assert.equal(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'), 'the old catalog');
});

test('a locale slug that could name a path is refused', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({ [API]: { translation_sets: [{ locale: '../evil', slug: 'default', percent_translated: 100, current_count: 1 }] } });
	await assert.rejects(downloadTranslations({ dir, fetch }), /Refusing the locale slug/);
	assert.deepEqual(fs.readdirSync(dir), []);
});

test('an answer in an unexpected shape is refused and changes nothing', async (t) => {
	// Read as "nothing translated", any of these would remove every catalog and
	// exit cleanly, and a release would ship without its translations.
	for (const body of [{}, { translation_sets: [] }, { translation_sets: [{ locale: 'de', percent: 100 }] }]) {
		const dir = tempDir(t);
		fs.writeFileSync(path.join(dir, 'de.json'), 'the old catalog');
		const { fetch } = fakeFetch({ [API]: body });
		await assert.rejects(downloadTranslations({ dir, fetch }), /in a shape this script does not know/, JSON.stringify(body));
		assert.equal(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'), 'the old catalog');
	}
});

test('a locale no OS language selects still ships, and is marked as such', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [
			{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 26 },
			{ locale: 'pirate', slug: 'default', percent_translated: 100, current_count: 26 }
		] },
		[exportUrl('de')]: catalog('de', 'x'),
		[exportUrl('pirate')]: catalog('pirate', 'x')
	});

	const result = await downloadTranslations({ dir, fetch });

	assert.deepEqual(fs.readdirSync(dir).sort(), ['de.json', 'pirate.json']);
	assert.deepEqual(result.shipped.map(({ locale, selectable }) => [locale, selectable]), [['de', true], ['pirate', false]]);
	assert.deepEqual(result.skipped, []);
});

test('a right-to-left locale is held back until the styles support it', async (t) => {
	const dir = tempDir(t);
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [
			{ locale: 'ar', slug: 'default', percent_translated: 100, current_count: 26 },
			{ locale: 'he', slug: 'default', percent_translated: 95, current_count: 25 },
			{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 26 }
		] },
		[exportUrl('de')]: catalog('de', 'x')
	});

	const result = await downloadTranslations({ dir, fetch });

	assert.deepEqual(fs.readdirSync(dir), ['de.json']);
	assert.deepEqual(result.skipped.map(({ locale }) => locale), ['ar', 'he']);
	assert.match(result.skipped[0].reason, /right-to-left/);
});

test('a throttled request waits as long as it is asked, then tries again', async (t) => {
	const dir = tempDir(t);
	const waits = [];
	let throttled = 2;
	const fetch = async (url) => {
		if (url === API) return { ok: true, status: 200, json: async () => ({ translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 1 }] }) };
		if (throttled-- > 0) return { ok: false, status: 429, headers: new Map([['retry-after', '7']]), json: async () => ({}) };
		return { ok: true, status: 200, json: async () => catalog('de', 'x') };
	};

	await downloadTranslations({ dir, fetch, wait: async (ms) => waits.push(ms) });

	assert.deepEqual(waits, [7000, 7000]);
	assert.deepEqual(fs.readdirSync(dir), ['de.json']);
});

test('a request still throttled after three tries fails, and changes nothing', async (t) => {
	const dir = tempDir(t);
	const fetch = async (url) => (url === API
		? { ok: true, status: 200, json: async () => ({ translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 1 }] }) }
		: { ok: false, status: 429, headers: new Map(), json: async () => ({}) });
	const waits = [];

	await assert.rejects(downloadTranslations({ dir, fetch, wait: async (ms) => waits.push(ms) }), /429 from/);
	assert.deepEqual(waits, [15000, 15000]);
	assert.deepEqual(fs.readdirSync(dir), []);
});

test('the table lists each locale, what no OS language selects, what was held back and why, and what was removed', () => {
	const table = formatTable({
		shipped: [{ locale: 'de', percent: 100, strings: 26, selectable: true }, { locale: 'pirate', percent: 100, strings: 26, selectable: false }],
		skipped: [{ locale: 'ar', percent: 90, reason: 'right-to-left, held back until the styles support it' }],
		removed: ['fr']
	});
	assert.match(table, /\| de \| 100% \| 26 \|/);
	assert.match(table, /\| pirate \| 100% \| 26 \|/);
	assert.match(table, /no OS language selects it: pirate$/m);
	assert.match(table, /- ar \(90%\): right-to-left/);
	assert.match(table, /Removed: fr/);
});


test('locale selection leaves unselected catalogs untouched, including below-cutoff ones', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'fr.json'), 'kept');
	fs.writeFileSync(path.join(dir, 'pt-br.json'), 'removed');
	const { fetch, calls } = fakeFetch({ [API]: SETS, [exportUrl('de')]: catalog('de', 'x'), [exportUrl('pt-br')]: catalog('pt-br', 'x') });
	const result = await downloadTranslations({ dir, fetch, locales: ['de', 'pt-br'], minCoverage: 90 });
	assert.deepEqual(result.removed, []);
	assert.deepEqual(calls, [API, exportUrl('de'), exportUrl('pt-br')]);
	assert.equal(fs.readFileSync(path.join(dir, 'fr.json'), 'utf8'), 'kept');
});

test('a waiting-only list exports and counts only waiting strings', async (t) => {
	const dir = tempDir(t);
	const url = `${exportUrl('de')}&filters[status]=waiting`;
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 100, current_count: 10, waiting_count: 8, all_count: 10 }] },
		[url]: catalog('de', 'waiting')
	});
	const result = await downloadTranslations({ dir, fetch, status: ['waiting'] });
	assert.deepEqual(result.shipped, [{ locale: 'de', percent: 80, strings: 8, selectable: true }]);
});

test('invalid lists fail before fetching or changing catalogs', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'de.json'), 'kept');
	const { fetch, calls } = fakeFetch({});
	for (const options of [{ status: [] }, { status: ['typo'] }, { locales: [] }, { locales: ['../de'] }]) {
		await assert.rejects(downloadTranslations({ dir, fetch, ...options }), /must be a non-empty list/);
	}
	assert.deepEqual(calls, []);
	assert.equal(fs.readFileSync(path.join(dir, 'de.json'), 'utf8'), 'kept');
});


test('the reported singular locale command preserves other catalogs and ignores the threshold', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'en-gb.json'), 'existing English catalog');
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'de', slug: 'default', percent_translated: 0, current_count: 0, waiting_count: 1, all_count: 26 }] },
		[`${exportUrl('de')}&filters[status]=waiting`]: catalog('de', 'waiting')
	});
	const result = await downloadTranslations({ ...parseArgs(['--status=waiting', '--locale=de']), dir, fetch });
	assert.deepEqual(result.shipped.map(({ locale }) => locale), ['de']);
	assert.deepEqual(result.removed, []);
	assert.equal(fs.readFileSync(path.join(dir, 'en-gb.json'), 'utf8'), 'existing English catalog');
});

test('CLI accepts both locale spellings and rejects unknown or duplicate flags', () => {
	assert.deepEqual(parseArgs(['--locale=de,fr']), { locales: ['de', 'fr'] });
	assert.deepEqual(parseArgs(['--locales=de,fr']), { locales: ['de', 'fr'] });
	assert.throws(() => parseArgs(['--lang=de']), /Unknown or invalid argument/);
	assert.throws(() => parseArgs(['--locale=de', '--locales=fr']), /only once/);
});

// build.electronLanguages follows the catalogs. Electron's locale names are handed in, as Windows
// names them, so the test reads no installed Electron.
const WIN_LOCALES = ['cs', 'de', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'pt-BR', 'pt-PT'];

function tempPackageJson(t, electronLanguages) {
	const file = path.join(tempDir(t), 'package.json');
	fs.writeFileSync(file, `${JSON.stringify({ name: 'x', build: { files: ['src/**/*'], electronLanguages }, devDependencies: {} }, null, 2)}\n`);
	return file;
}

test('the Chromium locales follow every catalog left in the directory, and only the list changes', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'cs.json'), 'existing Czech catalog');
	const packageJson = tempPackageJson(t, ['en-US', 'cs']);
	const before = fs.readFileSync(packageJson, 'utf8');
	const { fetch } = fakeFetch({
		[API]: { translation_sets: [{ locale: 'pt-br', slug: 'default', percent_translated: 100, current_count: 26 }] },
		[exportUrl('pt-br')]: catalog('pt-br', 'Nenhum site ainda.')
	});

	const result = await downloadTranslations({ dir, fetch, locales: ['pt-br'], packageJson, electronLocales: WIN_LOCALES });

	const list = ['en-US', 'cs', 'pt-BR', 'pt_BR'];
	assert.deepEqual(result.electronLanguages, { list, changed: true });
	const after = fs.readFileSync(packageJson, 'utf8');
	assert.deepEqual(JSON.parse(after).build.electronLanguages, list);
	assert.equal(after, before.replace('"cs"\n', '"cs",\n      "pt-BR",\n      "pt_BR"\n'), 'nothing else in package.json moves');
});

test('a removed catalog takes its Chromium locale with it', async (t) => {
	const dir = tempDir(t);
	fs.writeFileSync(path.join(dir, 'fr.json'), 'old French catalog');
	const packageJson = tempPackageJson(t, ['en-US', 'de', 'fr']);
	const { fetch } = fakeFetch({ [API]: SETS, [exportUrl('de')]: catalog('de', 'x'), [exportUrl('pt-br')]: catalog('pt-br', 'y') });

	const result = await downloadTranslations({ dir, fetch, packageJson, electronLocales: WIN_LOCALES });

	assert.deepEqual(result.removed, ['fr']);
	assert.deepEqual(JSON.parse(fs.readFileSync(packageJson, 'utf8')).build.electronLanguages, ['en-US', 'de', 'pt-BR', 'pt_BR']);
});

test('a list that already matches leaves package.json unwritten', async (t) => {
	const dir = tempDir(t);
	const packageJson = tempPackageJson(t, ['en-US', 'de', 'pt-BR', 'pt_BR']);
	const stamp = new Date('2001-01-01T00:00:00Z');
	fs.utimesSync(packageJson, stamp, stamp);
	const { fetch } = fakeFetch({ [API]: SETS, [exportUrl('de')]: catalog('de', 'x'), [exportUrl('pt-br')]: catalog('pt-br', 'y') });

	const result = await downloadTranslations({ dir, fetch, packageJson, electronLocales: WIN_LOCALES });

	assert.equal(result.electronLanguages.changed, false);
	assert.equal(fs.statSync(packageJson).mtimeMs, stamp.getTime());
});

test('a failed export leaves package.json alone, and without one nothing is asked of it', async (t) => {
	const packageJson = tempPackageJson(t, ['en-US']);
	const before = fs.readFileSync(packageJson, 'utf8');
	const { fetch } = fakeFetch({ [API]: SETS, [exportUrl('de')]: catalog('de', 'x'), [exportUrl('pt-br')]: 500 });
	await assert.rejects(downloadTranslations({ dir: tempDir(t), fetch, packageJson, electronLocales: WIN_LOCALES }), /500/);
	assert.equal(fs.readFileSync(packageJson, 'utf8'), before);

	const ok = fakeFetch({ [API]: SETS, [exportUrl('de')]: catalog('de', 'x'), [exportUrl('pt-br')]: catalog('pt-br', 'y') });
	const result = await downloadTranslations({ dir: tempDir(t), fetch: ok.fetch });
	assert.equal(result.electronLanguages, null);
});

test('the table names the Chromium locales only when this run changed them', () => {
	const base = { shipped: [{ locale: 'de', percent: 100, strings: 26, selectable: true }], removed: [] };
	assert.match(formatTable({ ...base, electronLanguages: { list: ['en-US', 'de'], changed: true } }), /Chromium locales kept \(build\.electronLanguages\): en-US, de/);
	assert.doesNotMatch(formatTable({ ...base, electronLanguages: { list: ['en-US', 'de'], changed: false } }), /Chromium locales/);
	assert.doesNotMatch(formatTable(base), /Chromium locales/);
});
