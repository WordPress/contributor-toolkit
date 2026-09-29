// Downloads the app's translations from translate.wordpress.org into src/languages/.
//
// `npm run i18n:download`, run from the repository root as part of the version-bump
// pull request. It writes one Jed JSON file per locale that is at least
// MIN_COVERAGE percent translated, removes the file of any locale that has
// fallen below it, and prints a table for the pull request description.
//
// Nothing in src/languages/ changes unless every download succeeded: the files are
// written to a temporary directory first and copied in at the end.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(REPO_ROOT, 'src', 'languages');
const DEFAULT_PROJECT = 'contributor-toolkit';
const BASE_URL = 'https://translate.wordpress.org';
const USER_AGENT = 'WordPress Contributor Toolkit (https://github.com/WordPress/contributor-toolkit)';

// A locale ships once this much of it is translated. Below it, a contributor
// would see a screen that is half English, so the locale stays on
// translate.wordpress.org until it is ready.
const MIN_COVERAGE = 80;

// A slug from the API becomes a file name, so it must be only what a locale
// slug is made of.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Downloads every locale of `project` at or above `minCoverage` into `dir`.
 *
 * @param {Object}   [options]
 * @param {string}   [options.project]     The project under translate.wordpress.org's `meta/`.
 * @param {string}   [options.dir]         Where the catalogs go.
 * @param {number}   [options.minCoverage] The percent a locale needs to ship.
 * @param {Function} [options.fetch]       `fetch`, replaceable in tests.
 * @return {Promise<{shipped: Object[], removed: string[]}>} What was written, and what was removed.
 */
async function downloadTranslations({
	project = DEFAULT_PROJECT,
	dir = DEFAULT_DIR,
	minCoverage = MIN_COVERAGE,
	fetch = globalThis.fetch
} = {}) {
	const get = async (url) => {
		const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
		if (!res.ok) {
			const error = new Error(`${res.status} from ${url}`);
			error.status = res.status;
			throw error;
		}
		return res.json();
	};

	let sets;
	try {
		({ translation_sets: sets } = await get(`${BASE_URL}/api/projects/meta/${project}/`));
	} catch (e) {
		if (e.status === 404) {
			throw new Error(`translate.wordpress.org has no project meta/${project} yet. It is created by the Meta team; see "Translatable strings" in CONTRIBUTING.md.`);
		}
		throw e;
	}

	const shipped = sets
		.filter((set) => set.locale !== 'en' && set.percent_translated >= minCoverage)
		.map((set) => ({ locale: set.locale, percent: set.percent_translated, strings: set.current_count }))
		.sort((a, b) => a.locale.localeCompare(b.locale));

	const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-languages-'));
	try {
		for (const { locale } of shipped) {
			if (!SLUG_PATTERN.test(locale)) throw new Error(`Refusing the locale slug ${JSON.stringify(locale)}: it is not a locale.`);
			// One at a time: a burst of requests is what translate.wordpress.org throttles.
			const catalog = await get(`${BASE_URL}/projects/meta/${project}/${locale}/default/export-translations/?format=jed1x`);
			if (!catalog?.locale_data?.messages) throw new Error(`The ${locale} export has no locale_data.messages.`);
			fs.writeFileSync(path.join(staging, `${locale}.json`), `${JSON.stringify(catalog, null, '\t')}\n`);
		}

		fs.mkdirSync(dir, { recursive: true });
		const keep = new Set(shipped.map(({ locale }) => `${locale}.json`));
		const removed = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !keep.has(name));
		for (const name of removed) fs.rmSync(path.join(dir, name));
		for (const name of keep) fs.copyFileSync(path.join(staging, name), path.join(dir, name));
		return { shipped, removed: removed.map((name) => name.replace(/\.json$/, '')) };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * The Markdown table for the release pull request.
 *
 * @param {{shipped: Object[], removed: string[]}} result What downloadTranslations returned.
 * @return {string}
 */
function formatTable({ shipped, removed }) {
	const rows = shipped.map(({ locale, percent, strings }) => `| ${locale} | ${percent}% | ${strings} |`);
	const table = ['| Locale | Translated | Strings |', '| --- | --- | --- |', ...rows].join('\n');
	return removed.length ? `${table}\n\nRemoved, below ${MIN_COVERAGE}%: ${removed.join(', ')}` : table;
}

module.exports = { downloadTranslations, formatTable, MIN_COVERAGE };

if (require.main === module) {
	const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
	const project = projectArg ? projectArg.slice('--project='.length) : DEFAULT_PROJECT;
	downloadTranslations({ project }).then(
		(result) => {
			console.log(result.shipped.length || result.removed.length ? formatTable(result) : `No locale of meta/${project} is at ${MIN_COVERAGE}% yet.`);
		},
		(e) => {
			console.error(e.message);
			process.exit(1);
		}
	);
}
