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
// The fake sites are empty directories (plus a canned debug.log): the renderer
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

const DEBUG_LOG_LINES = [
	'[10-Aug-2026 09:12:44 UTC] PHP Notice:  Undefined variable $post in /wordpress/wp-content/themes/twentytwentyfive/functions.php on line 112',
	'[10-Aug-2026 09:12:45 UTC] PHP Deprecated:  Function get_page_by_title is deprecated since version 6.2.0! Use WP_Query instead.',
	''
].join('\n');

/**
 * Creates the fixture site directories and a seeded userData dir.
 *
 * @param {string} variant 'seeded' for a populated site list, 'empty' for a
 *                         first-launch app with no sites.
 * @return {{userDataDir: string, sites: Object<string,string>}} Paths the
 *         harness needs: where the app's state lives and where each fake site is.
 */
function buildFixture(variant) {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-userdata-'));

	if (variant === 'empty') {
		writeSettings(userDataDir, { sites: [], siteMeta: {}, preferences: {} });
		return { userDataDir, sites: {} };
	}

	const wizardSite = path.join(FIXTURE_ROOT, 'wordpress-develop');
	const readySite = path.join(FIXTURE_ROOT, 'my-first-patch');
	const staleSite = path.join(FIXTURE_ROOT, 'older-site');

	for (const site of [wizardSite, readySite, staleSite]) {
		fs.mkdirSync(path.join(site, 'wp-content'), { recursive: true });
	}
	fs.writeFileSync(path.join(readySite, 'wp-content', 'debug.log'), DEBUG_LOG_LINES);

	// Dates are fixed, not computed from "now": the amber staleness dot needs
	// staleSite to be more than 14 days behind, and the other two to be fresh
	// enough not to be flagged. Retaking the screenshots years from now flips
	// the fresh sites amber too — bump these dates when that happens.
	writeSettings(userDataDir, {
		sites: [wizardSite, readySite, staleSite],
		siteMeta: {
			[wizardSite]: {
				initialized: true,
				createdAt: '2026-08-09T10:00:00.000Z',
				label: 'wordpress-develop',
				trunkDate: '2026-08-09T09:00:00.000Z'
			},
			[readySite]: {
				initialized: true,
				createdAt: '2026-08-01T10:00:00.000Z',
				label: 'my-first-patch',
				trunkDate: '2026-08-08T09:00:00.000Z',
				skipInitWizard: true,
				tracTicket: '60000'
			},
			[staleSite]: {
				initialized: true,
				createdAt: '2026-06-01T10:00:00.000Z',
				label: 'older-site',
				trunkDate: '2026-06-01T09:00:00.000Z',
				skipInitWizard: true
			}
		},
		preferences: {
			wporgHandle: 'contributor',
			contributionEvent: 'WordCamp Example 2026'
		}
	});

	return { userDataDir, sites: { wizardSite, readySite, staleSite } };
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

module.exports = { buildFixture, cleanFixtureSites, FIXTURE_ROOT };
