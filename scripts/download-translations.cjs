// Downloads the app's translations from translate.wordpress.org into src/languages/.
//
// `npm run i18n:download`, run from the repository root as part of the version-bump
// pull request. It writes one Jed JSON file per locale that is at least
// MIN_COVERAGE percent translated, removes the file of any locale that has
// fallen below it, and prints a table for the pull request description.
//
// Nothing in src/languages/ changes unless every download succeeded: the files are
// written to a temporary directory first, and each one replaces its old copy by a
// rename, which leaves either the old file or the new one, never a partial one.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { reachableSlugs } = require('../src/i18n.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(REPO_ROOT, 'src', 'languages');
const DEFAULT_PROJECT = 'contributor-toolkit';
const BASE_URL = 'https://translate.wordpress.org';
const USER_AGENT = 'WordPress Contributor Toolkit (https://github.com/WordPress/contributor-toolkit)';

// A locale ships once this much of it is translated. Below it, a contributor
// would see a screen that is half English, so the locale stays on
// translate.wordpress.org until it is ready.
const MIN_COVERAGE = 80;

// How often a throttled request is tried, and how long to wait between tries.
const MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_SECONDS = 15;
const MAX_RETRY_SECONDS = 60;

// A slug from the API becomes a file name, so it must be only what a locale
// slug is made of.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Right-to-left languages are held back until the app's styles support them.
// The page's direction already follows the catalog, but @wordpress/components'
// RTL stylesheet is not loaded and the app's own styles use left and right, so
// an Arabic or Hebrew catalog today would ship a half-mirrored window.
const RTL_LANGUAGES = new Set(['ar', 'arq', 'ary', 'azb', 'ckb', 'dv', 'fa', 'haz', 'he', 'ps', 'rhg', 'sd', 'skr', 'snd', 'syr', 'ug', 'ur', 'yi']);

/**
 * Downloads every locale of `project` at or above `minCoverage` into `dir`.
 *
 * @param {Object}   [options]
 * @param {string}   [options.project]     The project under translate.wordpress.org's `meta/`.
 * @param {string}   [options.dir]         Where the catalogs go.
 * @param {number}   [options.minCoverage] The percent a locale needs to ship.
 * @param {Function} [options.fetch]       `fetch`, replaceable in tests.
 * @param {Function} [options.wait]        Waits the given milliseconds; replaceable in tests.
 * @return {Promise<{shipped: Object[], skipped: Object[], removed: string[]}>} What was written, what
 *         passed the cut-off but was held back and why, and what was removed.
 */
async function downloadTranslations({
	project = DEFAULT_PROJECT,
	dir = DEFAULT_DIR,
	minCoverage = MIN_COVERAGE,
	fetch = globalThis.fetch,
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
} = {}) {
	const get = async (url) => {
		let res;
		// translate.wordpress.org answers 429 when asked too often, even one request
		// at a time. Wait as long as it asks (capped) and try again, a few times.
		for (let attempt = 1; ; attempt++) {
			res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
			if (res.status !== 429 || attempt === MAX_ATTEMPTS) break;
			const seconds = Number(res.headers?.get?.('retry-after')) || DEFAULT_RETRY_SECONDS;
			await wait(Math.min(seconds, MAX_RETRY_SECONDS) * 1000);
		}
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
			throw new Error(`translate.wordpress.org has no project meta/${project} yet. The Meta team creates it on request; see "Translatable strings" in CONTRIBUTING.md.`);
		}
		throw e;
	}

	// An answer in any other shape is refused rather than read as "nothing is
	// translated", which would remove every catalog and still exit cleanly.
	const valid = Array.isArray(sets) && sets.length > 0 &&
		sets.every((set) => typeof set?.locale === 'string' && typeof set.slug === 'string' && typeof set.percent_translated === 'number');
	if (!valid) throw new Error(`translate.wordpress.org answered for meta/${project} in a shape this script does not know; nothing was changed.`);

	const reachable = reachableSlugs();
	const shipped = [];
	const skipped = [];
	for (const set of sets) {
		// A variant, such as German (formal), shares its locale with the default
		// set, but the export below is always the default set's.
		if (set.slug !== 'default') continue;
		if (set.locale === 'en' || set.percent_translated < minCoverage) continue;
		if (!SLUG_PATTERN.test(set.locale)) throw new Error(`Refusing the locale slug ${JSON.stringify(set.locale)}: it is not a locale.`);
		const row = { locale: set.locale, percent: set.percent_translated, strings: set.current_count };
		if (!reachable.has(set.locale)) skipped.push({ ...row, reason: 'the app never selects this locale' });
		else if (RTL_LANGUAGES.has(set.locale.split('-')[0])) skipped.push({ ...row, reason: 'right-to-left, held back until the styles support it' });
		else shipped.push(row);
	}
	const byLocale = (a, b) => a.locale.localeCompare(b.locale);
	shipped.sort(byLocale);
	skipped.sort(byLocale);

	const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-languages-'));
	try {
		for (const { locale } of shipped) {
			// One at a time: a burst of requests is what translate.wordpress.org throttles.
			const catalog = await get(`${BASE_URL}/projects/meta/${project}/${locale}/default/export-translations/?format=jed1x`);
			// The same test resolveCatalog in src/i18n.cjs applies, so nothing ships that the app would skip.
			const messages = catalog?.locale_data?.messages;
			if (!messages || typeof messages !== 'object' || Array.isArray(messages)) throw new Error(`The ${locale} export has no locale_data.messages.`);
			fs.writeFileSync(path.join(staging, `${locale}.json`), `${JSON.stringify(catalog, null, '\t')}\n`);
		}

		fs.mkdirSync(dir, { recursive: true });
		const keep = shipped.map(({ locale }) => `${locale}.json`);
		// Copied in beside their final names first, so a copy that fails (a full
		// disk) leaves every old catalog in place; only the renames replace them.
		try {
			for (const name of keep) fs.copyFileSync(path.join(staging, name), path.join(dir, `${name}.download`));
		} catch (e) {
			for (const name of keep) fs.rmSync(path.join(dir, `${name}.download`), { force: true });
			throw e;
		}
		for (const name of keep) fs.renameSync(path.join(dir, `${name}.download`), path.join(dir, name));
		const removed = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !keep.includes(name));
		for (const name of removed) fs.rmSync(path.join(dir, name));
		return { shipped, skipped, removed: removed.map((name) => name.replace(/\.json$/, '')) };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * The Markdown table for the release pull request.
 *
 * @param {{shipped: Object[], skipped?: Object[], removed: string[]}} result What downloadTranslations returned.
 * @return {string}
 */
function formatTable({ shipped, skipped = [], removed }) {
	const rows = shipped.map(({ locale, percent, strings }) => `| ${locale} | ${percent}% | ${strings} |`);
	const parts = [['| Locale | Translated | Strings |', '| --- | --- | --- |', ...rows].join('\n')];
	if (skipped.length) parts.push(`Not shipped:\n${skipped.map(({ locale, percent, reason }) => `- ${locale} (${percent}%): ${reason}`).join('\n')}`);
	if (removed.length) parts.push(`Removed: ${removed.join(', ')}`);
	return parts.join('\n\n');
}

module.exports = { downloadTranslations, formatTable, MIN_COVERAGE };

if (require.main === module) {
	const projectArg = process.argv.find((arg) => arg.startsWith('--project='));
	const project = projectArg ? projectArg.slice('--project='.length) : DEFAULT_PROJECT;
	downloadTranslations({ project }).then(
		(result) => {
			console.log(result.shipped.length || result.skipped.length || result.removed.length ? formatTable(result) : `No locale of meta/${project} is at ${MIN_COVERAGE}% yet.`);
		},
		(e) => {
			console.error(e.message);
			process.exit(1);
		}
	);
}
