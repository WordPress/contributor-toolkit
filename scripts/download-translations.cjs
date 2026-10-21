// Downloads the app's translations from translate.wordpress.org into src/languages/.
//
// `npm run i18n:download`, run from the repository root as part of the version-bump
// pull request. It writes one Jed JSON file per locale that is at least
// MIN_COVERAGE percent translated, removes the file of any locale that has
// fallen below it, writes `build.electronLanguages` in package.json to match the
// catalogs it leaves (scripts/chromium-locales.cjs), and prints a table for the
// pull request description.
//
// Use `--status=current,waiting` to select translation statuses for the export
// only. Explicit status or locale selection bypasses the coverage cut-off.
// `--locales=de,fr` limits changes to those locales.
//
// Nothing in src/languages/ changes unless every download succeeded: the files are
// written to a temporary directory first, and each one replaces its old copy by a
// rename, which leaves either the old file or the new one, never a partial one.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slugTag } = require('../src/i18n.cjs');
const { electronLanguages, electronLocaleNames } = require('./chromium-locales.cjs');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(REPO_ROOT, 'src', 'languages');
const DEFAULT_PROJECT = 'meta/contributor-toolkit';
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
 * @param {string}   [options.project]         The full project path on translate.wordpress.org.
 * @param {string}   [options.dir]             Where the catalogs go.
 * @param {number}   [options.minCoverage]     The percent a locale needs to ship.
 * @param {string[]} [options.status]          Statuses to export: current, waiting, fuzzy.
 * @param {string[]} [options.locales]         Limit changes to these locale slugs.
 * @param {Function} [options.fetch]           `fetch`, replaceable in tests.
 * @param {Function} [options.wait]            Waits the given milliseconds; replaceable in tests.
 * @param {string}   [options.packageJson]     The package.json whose `build.electronLanguages` follows
 *                                             the catalogs; left alone when not given.
 * @param {string[]} [options.electronLocales] Electron's locale names; read from the installed
 *                                             Electron when not given.
 * @return {Promise<{shipped: Object[], skipped: Object[], removed: string[], electronLanguages: ?Object}>}
 *         What was written, each with whether the app can select it yet; what passed the cut-off
 *         but was held back and why; what was removed; and, with `packageJson`, the list it now
 *         holds and whether this run changed it.
 */
async function downloadTranslations({
	project = DEFAULT_PROJECT,
	dir = DEFAULT_DIR,
	minCoverage = MIN_COVERAGE,
	status,
	locales,
	fetch = globalThis.fetch,
	wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	packageJson,
	electronLocales
} = {}) {
	const explicitSelection = status !== undefined || locales !== undefined;
	status ??= ['current'];
	if (!Array.isArray(status) || !status.length || status.some((value) => !['current', 'waiting', 'fuzzy'].includes(value))) {
		throw new Error('Status must be a non-empty list of current, waiting or fuzzy.');
	}
	status = [...new Set(status)];
	if (locales !== undefined && (!Array.isArray(locales) || !locales.length || locales.some((locale) => !SLUG_PATTERN.test(locale)))) {
		throw new Error('Locales must be a non-empty list of locale slugs.');
	}
	const currentOnly = status.length === 1 && status[0] === 'current';
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
		({ translation_sets: sets } = await get(`${BASE_URL}/api/projects/${project}/`));
	} catch (e) {
		if (e.status === 404) {
			throw new Error(`translate.wordpress.org has no project ${project} yet. The Meta team creates it on request; see "Translatable strings" in CONTRIBUTING.md.`);
		}
		throw e;
	}

	// An answer in any other shape is refused rather than read as "nothing is
	// translated", which would remove every catalog and still exit cleanly.
	const valid = Array.isArray(sets) && sets.length > 0 &&
		sets.every((set) => typeof set?.locale === 'string' && typeof set.slug === 'string' && typeof set.percent_translated === 'number');
	if (!valid) throw new Error(`translate.wordpress.org answered for ${project} in a shape this script does not know; nothing was changed.`);


	const shipped = [];
	const skipped = [];
	for (const set of sets) {
		// A variant, such as German (formal), shares its locale with the default
		// set, but the export below is always the default set's.
		if (set.slug !== 'default' || (locales && !locales.includes(set.locale))) continue;
		if (!currentOnly && (!Number.isInteger(set.all_count) || set.all_count < 0 || status.some((value) => !Number.isInteger(set[`${value}_count`]) || set[`${value}_count`] < 0))) {
			throw new Error(`translate.wordpress.org answered for ${project} without valid translation counts; nothing was changed.`);
		}
		const strings = status.reduce((sum, value) => sum + set[`${value}_count`], 0);
		let percent = set.percent_translated;
		if (!currentOnly) percent = set.all_count ? Math.min(100, Math.floor(100 * strings / set.all_count)) : 0;
		if (set.locale === 'en' || (!explicitSelection && percent < minCoverage)) continue;
		if (!SLUG_PATTERN.test(set.locale)) throw new Error(`Refusing the locale slug ${JSON.stringify(set.locale)}: it is not a locale.`);
		const row = { locale: set.locale, percent, strings };
		if (RTL_LANGUAGES.has(set.locale.split('-')[0])) skipped.push({ ...row, reason: 'right-to-left, held back until the styles support it' });
		// Shipped even when no OS language selects it (`pirate`); the table names it.
		else shipped.push({ ...row, selectable: slugTag(set.locale) !== null });
	}
	const byLocale = (a, b) => a.locale.localeCompare(b.locale);
	shipped.sort(byLocale);
	skipped.sort(byLocale);

	// Read before anything is written: the electron package downloads its binary on the first
	// `require`, and a run that failed there after replacing the catalogs would be half applied.
	const names = packageJson ? (electronLocales ?? electronLocaleNames()) : null;

	const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-languages-'));
	try {
		for (const { locale } of shipped) {
			// One at a time: a burst of requests is what translate.wordpress.org throttles.
			const filters = currentOnly ? '' : `&filters[status]=${status.join('_or_')}`;
			const catalog = await get(`${BASE_URL}/projects/${project}/${locale}/default/export-translations/?format=jed1x${filters}`);
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
		const removed = fs.readdirSync(dir).filter((name) => name.endsWith('.json') && !keep.includes(name) && (!locales || locales.includes(name.slice(0, -5))));
		for (const name of removed) fs.rmSync(path.join(dir, name));
		const languages = packageJson ? writeElectronLanguages(packageJson, dir, names) : null;
		return { shipped, skipped, removed: removed.map((name) => name.replace(/\.json$/, '')), electronLanguages: languages };
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
}

/**
 * Sets `build.electronLanguages` in `packageJson` from every catalog in `dir`, not only the ones
 * this run touched, and writes the file only when the list changes. A parse and a two-space
 * stringify give back package.json byte for byte, so the list is the whole diff.
 *
 * @param {string}   packageJson The package.json to update.
 * @param {string}   dir         The catalogs.
 * @param {string[]} names       Electron's locale names.
 * @return {{list: string[], changed: boolean}}
 */
function writeElectronLanguages(packageJson, dir, names) {
	const slugs = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5));
	const list = electronLanguages(slugs, names);
	const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
	const changed = JSON.stringify(pkg.build.electronLanguages) !== JSON.stringify(list);
	if (changed) {
		pkg.build.electronLanguages = list;
		fs.writeFileSync(packageJson, `${JSON.stringify(pkg, null, 2)}\n`);
	}
	return { list, changed };
}

/**
 * The Markdown table for the release pull request.
 *
 * @param {{shipped: Object[], skipped?: Object[], removed: string[], electronLanguages?: ?Object}} result What downloadTranslations returned.
 * @return {string}
 */
function formatTable({ shipped, skipped = [], removed, electronLanguages: languages = null }) {
	const rows = shipped.map(({ locale, percent, strings }) => `| ${locale} | ${percent}% | ${strings} |`);
	const parts = [['| Locale | Translated | Strings |', '| --- | --- | --- |', ...rows].join('\n')];
	const unselectable = shipped.filter(({ selectable }) => selectable === false).map(({ locale }) => locale);
	if (unselectable.length) parts.push(`Shipped, but no OS language selects it: ${unselectable.join(', ')}`);
	if (skipped.length) parts.push(`Not shipped:\n${skipped.map(({ locale, percent, reason }) => `- ${locale} (${percent}%): ${reason}`).join('\n')}`);
	if (removed.length) parts.push(`Removed: ${removed.join(', ')}`);
	if (languages?.changed) parts.push(`Chromium locales kept (build.electronLanguages): ${languages.list.join(', ')}`);
	return parts.join('\n\n');
}

/**
 * Parses CLI options, refusing unknown flags before any catalogs can change.
 *
 * @param {string[]} args Command-line arguments.
 * @return {Object} Download options.
 */
function parseArgs(args) {
	const options = {};
	for (const arg of args) {
		const match = /^--(project|status|locale|locales)=(.+)$/.exec(arg);
		if (!match) throw new Error(`Unknown or invalid argument: ${arg}. Use --status=current,waiting and --locales=de,fr.`);
		const key = match[1] === 'locale' ? 'locales' : match[1];
		if (options[key] !== undefined) throw new Error(`Specify --${key} only once.`);
		options[key] = key === 'project' ? match[2] : match[2].split(',').map((value) => value.trim());
	}
	return options;
}

module.exports = { downloadTranslations, formatTable, MIN_COVERAGE, parseArgs };

if (require.main === module) {
	Promise.resolve().then(() => {
		const options = parseArgs(process.argv.slice(2));
		return downloadTranslations({ ...options, packageJson: path.join(REPO_ROOT, 'package.json') });
	}).then(
		(result) => {
			console.log(result.shipped.length || result.skipped.length || result.removed.length || result.electronLanguages?.changed ? formatTable(result) : `No locales downloaded.`);
		},
		(e) => {
			console.error(e.message);
			process.exit(1);
		}
	);
}
