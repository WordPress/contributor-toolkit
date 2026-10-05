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
// The fake sites are empty directories (plus a canned debug.log or build
// marker): the renderer tolerates a site whose git metadata cannot be read,
// and what it shows of a site's age comes from the seeded settings, so no
// real clone is needed. Nothing a shot does reaches the network or starts a
// process in them: see standInForTheOutside.

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

// What GitHub is said to answer when a ticket's card asks which pull requests
// cite it, as the main process hands it on. The card asks as soon as its site
// is opened; left to the network, a shot would show whatever GitHub says that
// day, or the card still asking.
const LINKED_PULL_REQUESTS = [
	{ number: 13245, url: 'https://github.com/WordPress/wordpress-develop/pull/13245', title: 'Docs: correct the default', state: 'open', commitDate: daysAgo(6, 12), updatedAt: daysAgo(5, 15) },
	{ number: 13012, url: 'https://github.com/WordPress/wordpress-develop/pull/13012', title: 'Docs: list the values', state: 'closed', updatedAt: daysAgo(40, 12) }
];

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
		{ filename: `${LINKED_TICKET}.diff`, url: `https://core.trac.wordpress.org/raw-attachment/ticket/${LINKED_TICKET}/${LINKED_TICKET}.diff`, applyable: true, author: 'janedoe', dateText: '6 weeks ago', sizeText: '3.2 KB' }
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
	await app.evaluate(({ ipcMain }, [ticket, prs, trac, smtpPort, serverUrl]) => {
		const replace = (channel, handler) => {
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, handler);
		};
		replace('git:list-ticket-patches', () => ({ ok: true, ticket, prs: { status: 'ok', items: prs, rankComplete: true } }));
		replace('trac:list-attachments', () => trac);
		replace('npm:run-script', async () => ({ runId: 'docs-fixture' }));
		// A start says where the mail server is listening and where the site
		// is served before it answers, as the real one does.
		replace('playground:start', async (event, sitePath) => {
			event.sender.send('smtp:started', { sitePath, port: smtpPort });
			event.sender.send('playground:url', { sitePath, url: serverUrl });
			return { ok: true, url: serverUrl };
		});
		replace('url:open', () => true);
	}, [LINKED_TICKET, LINKED_PULL_REQUESTS, TICKET_FROM_TRAC, SMTP_PORT, SERVER_URL]);
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

module.exports = { standInForTheOutside, buildFixture, cleanFixtureSites, FIXTURE_ROOT, TICKET_FROM_TRAC, LINKED_PULL_REQUESTS };
