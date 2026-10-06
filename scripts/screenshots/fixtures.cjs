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
// Most of the fake sites are empty directories (plus a canned debug.log or
// build marker): the renderer tolerates a site whose git metadata cannot be
// read, and what it shows of a site's age comes from the seeded settings, so
// no real clone is needed. The `repo:` variants' site is a real repository,
// made here and never cloned from anywhere, for the shots that need Git to
// have something to say. Nothing a shot does reaches the network or starts
// a server, an install or a build: see standInForTheOutside.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
// The fixture layer the journeys build their sites with: the app's own Git
// binary, so a repository made here is one the app reads as it reads a clone.
const { gitOk, initRepo, commitFiles, removeRepo } = require('../../tests/unit/helpers/git.cjs');

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
// runs on one UTC day draw the same pixels; the code's date is at midnight,
// since the app counts its age in whole days from it, and a later hour would
// make "126 days old" a day less for part of every day.
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days, hour) {
	const day = new Date(Date.now() - days * DAY_MS);
	day.setUTCHours(hour, 0, 0, 0);
	return day.toISOString();
}
const FRESH = { createdAt: daysAgo(2, 10), trunkDate: daysAgo(2, 0) };
const STALE = { createdAt: daysAgo(126, 10), trunkDate: daysAgo(126, 0) };

// The ticket the fixture's ready site is linked to.
const LINKED_TICKET = '60000';

// Another ticket the site has work on, for the pictures of a site's tickets.
const OTHER_TICKET = '61002';

// The tickets a `repo:` variant's site has work on before the app opens, and
// how many hours ago each was last worked on. The app could be driven to
// start and leave each, and every row would then say "Edited just now"; a
// list of tickets come back to is one whose rows have ages. The hours are
// well inside the row's wording for them ("Edited 3 hours ago", "Edited 1
// day ago"), so a picture is the same at any time of day, and the older is
// younger than the site.
const PARKED_TICKETS = {
	'repo:site-with-tickets': { [OTHER_TICKET]: 30 },
	'repo:ticket-list-card': { [OTHER_TICKET]: 30 },
	'repo:ticket-list-unlinked': { [LINKED_TICKET]: 3.5, [OTHER_TICKET]: 30 }
};
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

// What GitHub is said to answer when a ticket's card asks which pull requests
// cite it, as the main process hands it on. The card asks as soon as its site
// is opened; left to the network, a shot would show whatever GitHub says that
// day, or the card still asking.
const LINKED_PULL_REQUESTS = [
	{ number: 13245, url: 'https://github.com/WordPress/wordpress-develop/pull/13245', title: 'Docs: correct the default', state: 'open', commitDate: daysAgo(6, 12), updatedAt: daysAgo(5, 15) },
	{ number: 13012, url: 'https://github.com/WordPress/wordpress-develop/pull/13012', title: 'Docs: list the values', state: 'closed', updatedAt: daysAgo(40, 12) }
];

// The file the fixture's ticket is about, as trunk has it, and what the
// contributor makes of it. The ticket says a filter's documentation is
// inconsistent: the code passes 45 and the comment says 40. Written for the
// fixture: no function or filter of WordPress's is called this.
const SUMMARY_FILE = 'src/wp-includes/summary-length.php';
const SUMMARY_LINES = [
	'<?php',
	'/**',
	' * How long a summary may be.',
	' *',
	' * @package WordPress',
	' */',
	'',
	'/**',
	' * Filters how many words a summary is cut to.',
	' *',
	' * @since 6.9.0',
	' *',
	' * @param int $words How many words, at most. Default 40.',
	' */',
	'function example_summary_length() {',
	"	return (int) apply_filters( 'example_summary_length', 45 );",
	'}'
];
// The one line that is wrong, where it is, and the two ways of putting it
// right: the contributor's, and the one in the patch on the ticket.
const WRONG_LINE = SUMMARY_LINES.findIndex((line) => line.includes('Default 40.'));
const FIXED_LINE = SUMMARY_LINES[WRONG_LINE].replace('Default 40.', 'Default 45.');
const PATCHED_LINE = SUMMARY_LINES[WRONG_LINE].replace('Default 40.', 'Default is 45.');
const SUMMARY_ON_TRUNK = `${SUMMARY_LINES.join('\n')}\n`;
const SUMMARY_FIXED = `${SUMMARY_LINES.map((line, index) => (index === WRONG_LINE ? FIXED_LINE : line)).join('\n')}\n`;
// And a test the contributor adds beside the fix: a file trunk does not have.
const SUMMARY_TEST_FILE = 'tests/phpunit/tests/formatting/exampleSummaryLength.php';
const SUMMARY_TEST = [
	'<?php',
	'',
	'class Tests_Formatting_ExampleSummaryLength extends WP_UnitTestCase {',
	'	public function test_default_is_45_words() {',
	'		$this->assertSame( 45, example_summary_length() );',
	'	}',
	'}',
	''
].join('\n');

// The patch attached to the ticket on Trac: someone else's fix for the same
// line, written against trunk, with the three lines either side a patch
// usually carries. It fits a checkout that still says 40, and not one where
// the contributor has already changed that line. Its paths have no `src/`,
// as a patch from Trac's days before the folder does not.
const CONTEXT = 3;
const TICKET_PATCH = [
	`--- a/${SUMMARY_FILE.replace(/^src\//, '')}`,
	`+++ b/${SUMMARY_FILE.replace(/^src\//, '')}`,
	`@@ -${WRONG_LINE + 1 - CONTEXT},${2 * CONTEXT + 1} +${WRONG_LINE + 1 - CONTEXT},${2 * CONTEXT + 1} @@`,
	...SUMMARY_LINES.slice(WRONG_LINE - CONTEXT, WRONG_LINE).map((line) => ` ${line}`),
	`-${SUMMARY_LINES[WRONG_LINE]}`,
	`+${PATCHED_LINE}`,
	...SUMMARY_LINES.slice(WRONG_LINE + 1, WRONG_LINE + 1 + CONTEXT).map((line) => ` ${line}`),
	''
].join('\n');

// What Trac is said to answer when the card asks for the ticket itself: its
// facts, and the patch attached to it. The real answer is read off the
// ticket's page in a window of its own, past Trac's human-check, which is
// why this was a picture only a person could set up.
const TICKET_FROM_TRAC = {
	ok: true,
	status: 'ok',
	ticket: {
		summary: 'Inconsistent documentation for a filter',
		status: 'reviewing',
		resolution: '',
		type: 'defect (bug)',
		milestone: '7.2',
		component: { label: 'General', url: 'https://core.trac.wordpress.org/query?component=General' },
		keywords: [{ label: 'has-patch', url: 'https://core.trac.wordpress.org/query?keywords=~has-patch' }],
		// Older than the pull requests that cite it and the patch attached to it.
		opened: { relative: '8 weeks ago', absolute: new Date(daysAgo(56, 12)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
	},
	items: [
		{ filename: `${LINKED_TICKET}.diff`, url: `https://core.trac.wordpress.org/raw-attachment/ticket/${LINKED_TICKET}/${LINKED_TICKET}.diff`, applyable: true, author: 'janedoe', dateText: '6 weeks ago', sizeText: `${Buffer.byteLength(TICKET_PATCH)} bytes` }
	]
};

// Where the mail server is said to be listening and the dev server to be
// serving, once a shot has started the server.
const SMTP_PORT = 1025;
const SERVER_URL = 'http://127.0.0.1:9400/';

/**
 * Answers for the app what would otherwise be asked of the network or start
 * a process, so that a fixture shot is the same picture whatever the network
 * says, and no shot starts a server in a folder that holds no WordPress.
 * Installed in the main process once per launch, before the window is
 * reloaded for the first shot.
 *
 * The dev server and what it runs first are answered and never run: the
 * script is "started" and never ends, and the server's start says where the
 * mail server listens and where the site is served, as a real start does,
 * and answers. The window then has a running server, of which nothing is
 * running. Of what comes with a server, debug.log's tail is real, and its
 * shot counts on it: the window starts the tail itself, before the server.
 *
 * Trac is answered too, and nothing is opened in the browser: a server that
 * comes up opens its site there, and a shot must not open a tab on the
 * machine of whoever takes it.
 *
 * @param {import('playwright-core').ElectronApplication} app
 */
async function standInForTheOutside(app) {
	await app.evaluate(({ ipcMain }, [ticket, prs, trac, smtpPort, serverUrl, patch]) => {
		const replace = (channel, handler) => {
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, handler);
		};
		replace('git:list-ticket-patches', () => ({ ok: true, ticket, prs: { status: 'ok', items: prs, rankComplete: true } }));
		replace('trac:list-attachments', () => trac);
		replace('trac:fetch-attachment', () => ({ ok: true, text: patch }));
		// Nobody is signed in to GitHub, and a sign-in gets as far as its
		// code and stays there: nothing is asked of GitHub.
		replace('github:account', () => ({ ok: true, login: null, configured: true, testMode: null }));
		replace('github:sign-in', () => ({ ok: true, userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' }));
		replace('github:sign-in-cancel', () => ({ ok: true }));
		// An install is "started" and never ends, like the script.
		replace('npm:install', async () => ({ installId: 'docs-fixture' }));
		replace('npm:run-script', async () => ({ runId: 'docs-fixture' }));
		// A start says where the mail server is listening and where the site
		// is served before it answers, as the real one does.
		replace('playground:start', async (event, sitePath) => {
			event.sender.send('smtp:started', { sitePath, port: smtpPort });
			event.sender.send('playground:url', { sitePath, url: serverUrl });
			return { ok: true, url: serverUrl };
		});
		replace('url:open', () => true);
	}, [LINKED_TICKET, LINKED_PULL_REQUESTS, TICKET_FROM_TRAC, SMTP_PORT, SERVER_URL, TICKET_PATCH]);
}

// What an earlier run left in debug.log, stamped the way PHP stamps it and
// dated the day before the shots: after its site was made, like the mail.
function phpStamp(iso) {
	const [, year, month, day, time] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2}:\d{2})/.exec(iso);
	const name = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1];
	return `[${day}-${name}-${year} ${time} UTC]`;
}
const DEBUG_LOG_LINES = [
	`${phpStamp(daysAgo(1, 9).replace('09:00:00', '09:12:44'))} PHP Notice:  Undefined variable $post in /wordpress/wp-content/themes/twentytwentyfive/functions.php on line 112`,
	`${phpStamp(daysAgo(1, 9).replace('09:00:00', '09:12:45'))} PHP Deprecated:  Function get_page_by_title is deprecated since version 6.2.0! Use WP_Query instead.`,
	''
].join('\n');

/**
 * Creates the fixture site directories and a seeded userData dir.
 *
 * @param {string} variant 'seeded' or 'debug' for a populated Core site list,
 *                         'gutenberg' for a ready Gutenberg site, 'empty' for a first-launch app,
 *                         or 'repo:<slug>' for one site that is a real checkout.
 * @return {{userDataDir: string, sites: Object<string,string>}} Paths the
 *         harness needs: where the app's state lives and where each fake site is.
 */
function buildFixture(variant) {
	const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-userdata-'));
	// From nothing, every time: a variant with a repository in it leaves one
	// behind in a folder the next variant names as well.
	cleanFixtureSites();

	if (variant.startsWith('repo')) {
		return buildRepoFixture(userDataDir, variant);
	}

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
				tracTicket: LINKED_TICKET
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
				// After the site it came from was made.
				date: daysAgo(1, 9),
				sentAt: daysAgo(1, 9),
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

// The pictures are of the light theme whatever the maintainer's machine is
// set to (#560), unless a dark one is asked for: `SHOTS_THEME=dark`.
const SHOTS_THEME = process.env.SHOTS_THEME || 'light';

function writeSettings(userDataDir, settings) {
	fs.writeFileSync(
		path.join(userDataDir, 'settings.json'),
		JSON.stringify({ ...settings, preferences: { theme: SHOTS_THEME, ...(settings.preferences || {}) } }, null, '\t')
	);
}

/**
 * A site that is a real checkout: one commit on trunk, what `site:status`
 * reads as installed and built, and nothing linked. The shots that need a
 * diff, a ticket's branch or an update start from it and do the rest through
 * the app, so what is photographed is what the app made of it.
 *
 * Each such shot has a variant of its own (`repo:<slug>`), and so a
 * repository of its own: these shots write to the checkout and to the
 * registry, and one must not start from what another left.
 *
 * `repo:trunk-update-progress` also gets an origin to fetch from, a clone
 * beside the site that is one commit ahead of it. The variants in
 * PARKED_TICKETS get tickets that were started and left.
 *
 * @param {string} userDataDir
 * @param {string} variant
 * @return {{userDataDir: string, sites: Object<string,string>}} As buildFixture.
 */
function buildRepoFixture(userDataDir, variant) {
	const readySite = path.join(FIXTURE_ROOT, 'my-first-patch');
	fs.mkdirSync(path.dirname(path.join(readySite, SUMMARY_FILE)), { recursive: true });
	initRepo(readySite, { branch: 'trunk' });
	const tracked = {
		'.gitignore': 'node_modules/\nbuild/\n',
		'package.json': JSON.stringify({ name: 'wordpress-develop', version: '7.2.0', private: true, scripts: { build: 'node -e ""' } }, null, 2) + '\n',
		[SUMMARY_FILE]: SUMMARY_ON_TRUNK
	};
	for (const [file, content] of Object.entries(tracked)) {
		fs.writeFileSync(path.join(readySite, file), content);
	}
	// Dated as the seeded sites' code is. A commit is otherwise of the moment
	// it is made, and the app reads how old a site's code is off its trunk's
	// commit: the site's code would be newer than the site, and a ticket left
	// yesterday would have branched from today's trunk.
	commitFiles(readySite, Object.keys(tracked), 'trunk', { date: FRESH.trunkDate });

	// A ticket started and left with nothing done on it is a branch where
	// trunk was, and the record the app keeps of it: which ticket, where it
	// branched, and when it was last worked on.
	const trunkOid = gitOk(['rev-parse', 'HEAD'], readySite);
	const branches = {};
	for (const [ticket, hours] of Object.entries(PARKED_TICKETS[variant] || {})) {
		gitOk(['branch', `ticket/${ticket}`], readySite);
		branches[`ticket/${ticket}`] = { tracTicket: Number(ticket), baseOid: trunkOid, lastUsedAt: hoursAgo(hours) };
	}

	if (variant === 'repo:trunk-update-progress') {
		// A working clone and not a bare one, so the commit that moves trunk
		// on can be made in it with the same binary.
		const origin = path.join(FIXTURE_ROOT, '.origin-of-my-first-patch');
		gitOk(['clone', '-q', '--config', 'core.autocrlf=false', '--', readySite, origin], FIXTURE_ROOT);
		gitOk(['remote', 'add', 'origin', pathToFileURL(origin).href], readySite);
		fs.writeFileSync(path.join(origin, 'src', 'wp-includes', 'version.php'), "<?php\n$wp_version = '7.3-alpha';\n");
		commitFiles(origin, ['src/wp-includes/version.php'], 'trunk moves on');
	}

	// What `site:status` reads to decide the site is installed and built. The
	// folders are what is checked, not what is in them.
	fs.mkdirSync(path.join(readySite, 'node_modules', 'react'), { recursive: true });
	fs.mkdirSync(path.join(readySite, 'build', 'wp-includes', 'js', 'dist'), { recursive: true });

	writeSettings(userDataDir, {
		sites: [readySite],
		siteMeta: {
			[readySite]: { ...FRESH, initialized: true, label: 'my-first-patch', skipInitWizard: true, branches }
		},
		preferences: { wporgHandle: 'contributor', contributionEvent: 'WordCamp Example 2026' }
	});
	return { userDataDir, sites: { readySite } };
}

/**
 * Removes the fixture site directories. With `removeRepo`: some of them are
 * repositories, whose objects Git writes read-only, and a plain removal is
 * refused on Windows (#381).
 */
function cleanFixtureSites() {
	removeRepo(FIXTURE_ROOT);
}

module.exports = { standInForTheOutside, buildFixture, cleanFixtureSites, FIXTURE_ROOT, TICKET_FROM_TRAC, LINKED_PULL_REQUESTS, LINKED_TICKET, OTHER_TICKET, SUMMARY_FILE, SUMMARY_FIXED, FIXED_LINE, SUMMARY_TEST_FILE, SUMMARY_TEST };
