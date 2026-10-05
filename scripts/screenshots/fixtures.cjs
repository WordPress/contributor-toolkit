// Builds the throwaway state the screenshot harness points the app at.
//
// Two directories come out of this:
//   - a userData dir holding a seeded settings.json, handed to the app via
//     TOOLKIT_USER_DATA_DIR (see the guarded hook in src/main.js), so the
//     contributor's real site registry is never read or written;
//   - fake site directories under a deliberately username-free path, because
//     every path the app renders ends up in published pixels. safe-log.js
//     redacts logs; nothing redacts a screenshot, so the fixture path is the
//     mitigation.
//
// The fake sites are empty directories (plus a canned debug.log or build marker): the renderer
// tolerates a site whose git metadata cannot be read — it shows the site with
// no snapshot date rather than crashing — so no real clone is needed.

const fs = require('fs');
const os = require('os');
const path = require('path');

// /tmp, not os.tmpdir(): on macOS os.tmpdir() is a /var/folders/... maze that
// reads as noise in a screenshot. Windows has no /tmp, so fall back there.
const FIXTURE_ROOT =
	process.platform === 'win32'
		? path.join(os.tmpdir(), 'wpct-docs-fixture')
		: '/tmp/wpct-docs-fixture';

// When the fixture's sites were made and how old their code is, counted back
// from the day the shots are taken and not written down: a date written down
// is fresh for a fortnight and then every site in every picture wears the
// notice that its code is old. The amber dot needs `staleSite` more than 14
// days behind and the others well inside that. The hour is fixed, so two
// runs on one day draw the same pixels.
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days, hour) {
	const day = new Date(Date.now() - days * DAY_MS);
	day.setUTCHours(hour, 0, 0, 0);
	return day.toISOString();
}
const FRESH = { createdAt: daysAgo(2, 10), trunkDate: daysAgo(2, 9) };
const STALE = { createdAt: daysAgo(126, 10), trunkDate: daysAgo(126, 9) };

// What GitHub is said to answer when a ticket's card asks which pull requests
// cite it. The fixture's ticket is linked as the window opens, so the card
// asks at once; left to the network, a shot would show whatever GitHub says
// that day, or the card still asking.
const LINKED_PULL_REQUESTS = [
	{ number: 13245, url: 'https://github.com/WordPress/wordpress-develop/pull/13245', title: 'Docs: correct the default', state: 'open', commitDate: daysAgo(6, 12) },
	{ number: 13012, url: 'https://github.com/WordPress/wordpress-develop/pull/13012', title: 'Docs: list the values', state: 'closed', updatedAt: daysAgo(40, 12) }
];

/**
 * Answers for the app what would otherwise be asked of the network, so that
 * a fixture shot is the same picture whatever the network says. Installed in
 * the main process once per launch, before the window is reloaded for the
 * first shot.
 *
 * @param {import('playwright-core').ElectronApplication} app
 */
async function standInForTheNetwork(app) {
	await app.evaluate(({ ipcMain }, prs) => {
		ipcMain.removeHandler('git:list-ticket-patches');
		ipcMain.handle('git:list-ticket-patches', () => ({ ok: true, prs: { status: 'ok', items: prs } }));
	}, LINKED_PULL_REQUESTS);
}

const DEBUG_LOG_LINES = [
	'[10-Aug-2026 09:12:44 UTC] PHP Notice:  Undefined variable $post in /wordpress/wp-content/themes/twentytwentyfive/functions.php on line 112',
	'[10-Aug-2026 09:12:45 UTC] PHP Deprecated:  Function get_page_by_title is deprecated since version 6.2.0! Use WP_Query instead.',
	''
].join('\n');

/**
 * Creates the fixture site directories and a seeded userData dir.
 *
 * @param {string} variant 'seeded' or 'debug' for a populated Core site list,
 *                         'gutenberg' for a ready Gutenberg site, or 'empty' for a first-launch app.
 * @return {{userDataDir: string, sites: Object<string,string>}} Paths the
 *         harness needs: where the app's state lives and where each fake site is.
 */
function buildFixture(variant) {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-userdata-'));

	if (variant === 'empty') {
		writeSettings(userDataDir, { sites: [], siteMeta: {}, preferences: {} });
		return { userDataDir, sites: {} };
	}

	if (variant === 'gutenberg') {
		const gutenbergSite = path.join(FIXTURE_ROOT, 'my-gutenberg-fix');
		const buildMarker = path.join(gutenbergSite, 'build', 'scripts', 'block-library', 'index.min.js');
		fs.mkdirSync(path.dirname(buildMarker), { recursive: true });
		fs.writeFileSync(buildMarker, '');
		writeSettings(userDataDir, {
			sites: [gutenbergSite],
			siteMeta: {
				[gutenbergSite]: {
					initialized: true,
					...FRESH,
					label: 'my-gutenberg-fix',
					projectType: 'gutenberg',
					skipInitWizard: true
				}
			},
			preferences: {}
		});
		return { userDataDir, sites: { gutenbergSite } };
	}

	const wizardSite = path.join(FIXTURE_ROOT, 'wordpress-develop');
	const readySite = path.join(FIXTURE_ROOT, 'my-first-patch');
	const staleSite = path.join(FIXTURE_ROOT, 'older-site');
	const incompleteSite = path.join(FIXTURE_ROOT, 'needs-rebuild');

	for (const site of [wizardSite, readySite, staleSite, incompleteSite]) {
		fs.mkdirSync(site, { recursive: true });
	}
	fs.mkdirSync(path.join(readySite, 'build', 'wp-includes', 'js', 'dist'), { recursive: true });
	fs.mkdirSync(path.join(readySite, 'build', 'wp-content'), { recursive: true });
	fs.writeFileSync(path.join(readySite, 'build', 'wp-content', 'debug.log'), DEBUG_LOG_LINES);

	writeSettings(userDataDir, {
		sites: [wizardSite, readySite, staleSite, incompleteSite],
		siteMeta: {
			[wizardSite]: {
				initialized: true,
				...FRESH,
				label: 'wordpress-develop'
			},
			[readySite]: {
				initialized: true,
				...FRESH,
				label: 'my-first-patch',
				skipInitWizard: true,
				tracTicket: '60000'
			},
			[staleSite]: {
				initialized: true,
				...STALE,
				label: 'older-site',
				skipInitWizard: true
			},
			[incompleteSite]: {
				initialized: true,
				...FRESH,
				label: 'needs-rebuild',
				skipInitWizard: true,
				updateIncomplete: true
			}
		},
		[`siteMail:${readySite}`]: [
			{
				id: 'docs-welcome',
				subject: 'Welcome to WordPress Contributor Day',
				from: 'WordPress <wordpress@example.test>',
				to: 'contributor@example.test',
				date: '2026-08-10T09:30:00.000Z',
				sentAt: '2026-08-10T09:30:00.000Z',
				text: 'Your local WordPress site can send mail safely.',
				html: '<p>Your local WordPress site can send mail safely.</p>',
				headers: {},
				raw: 'Subject: Welcome to WordPress Contributor Day\n\nYour local WordPress site can send mail safely.'
			}
		],
		preferences: {
			wporgHandle: 'contributor',
			contributionEvent: 'WordCamp Example 2026'
		}
	});

	return { userDataDir, sites: { wizardSite, readySite, staleSite, incompleteSite } };
}

function writeSettings(userDataDir, settings) {
	fs.writeFileSync(
		path.join(userDataDir, 'settings.json'),
		JSON.stringify(settings, null, '\t')
	);
}

/** Removes the fixture site directories. userData dirs live under os.tmpdir() and are left to the OS. */
function cleanFixtureSites() {
	fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
}

module.exports = { standInForTheNetwork, buildFixture, cleanFixtureSites, FIXTURE_ROOT };
