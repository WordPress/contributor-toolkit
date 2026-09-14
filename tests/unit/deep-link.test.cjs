'use strict';

// The `wpct://` parser (#464). This is the one input to the app that comes from
// outside it — any page the contributor visits can navigate to this scheme, and
// on Windows and Linux the address lands in argv — so the refusals matter more
// here than the acceptances, and most of this file is refusals.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDeepLink, pickDeepLinkArg, handleDeepLink, createDeepLinkQueue, protocolRegistration, REFUSAL_REASONS, DEEP_LINK_SCHEME } = require('../../src/deep-link.cjs');

test('the scheme is the one the build config registers', () => {
	// package.json's build.protocols and this constant are the two halves of one
	// registration: the OS maps the scheme to the app, this module answers it.
	const { build } = require('../../package.json');
	const schemes = build.protocols.flatMap((p) => p.schemes);
	assert.ok(schemes.includes(DEEP_LINK_SCHEME), `build.protocols does not register ${DEEP_LINK_SCHEME}`);
});

test('the forms a link can take', () => {
	assert.deepEqual(parseDeepLink('wpct://ticket/62281'), { ok: true, ticket: 62281 });
	// A trailing slash is what a browser's address bar tends to produce.
	assert.deepEqual(parseDeepLink('wpct://ticket/62281/'), { ok: true, ticket: 62281 });
	// The scheme and the host arrive however the OS spells them.
	assert.deepEqual(parseDeepLink('WPCT://TICKET/62281'), { ok: true, ticket: 62281 });
});

test('the address is judged as it arrived, not as a URL parser rewrites it', () => {
	// Each of these is a shape `new URL()` would hand on as something else, and
	// the reason the accept decision is a literal match on the raw string. None
	// of them is dangerous — a ticket id is all that ever comes out — but each
	// would be an address the app answers and does not document.
	assert.equal(parseDeepLink('wpct://ticket/../../etc/passwd').reason, REFUSAL_REASONS.NOT_A_TICKET);
	// `..` is resolved before a path read off the parser would see it: this one
	// would otherwise arrive as ticket 9.
	assert.equal(parseDeepLink('wpct://ticket/62281/../9').reason, REFUSAL_REASONS.NOT_A_TICKET);
	// A control character in the middle of the scheme is stripped by the parser,
	// so this would otherwise validate as `wpct:`.
	assert.equal(parseDeepLink('wp\tct://ticket/62281').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/62281#/9').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink(' wpct://ticket/62281').reason, REFUSAL_REASONS.NOT_A_TICKET);
});

test('there is one spelling, and `?id=` is not it', () => {
	// Nothing produces the query form, and a second spelling is a second thing
	// to be sure about. It also used to be a way in: with a path that is not a
	// ticket, the query was read anyway.
	assert.equal(parseDeepLink('wpct://ticket?id=62281').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/not-a-ticket?id=9').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/62281?id=9').reason, REFUSAL_REASONS.NOT_A_TICKET);
});

test('only this scheme, and only this host', () => {
	assert.equal(parseDeepLink('https://ticket/62281').reason, REFUSAL_REASONS.WRONG_SCHEME);
	assert.equal(parseDeepLink('file:///etc/passwd').reason, REFUSAL_REASONS.WRONG_SCHEME);
	assert.equal(parseDeepLink('wpct://site/62281').reason, REFUSAL_REASONS.UNKNOWN_HOST);
	// No authority at all: `wpct:ticket/1` puts everything in the pathname.
	assert.equal(parseDeepLink('wpct:ticket/62281').reason, REFUSAL_REASONS.UNKNOWN_HOST);
	// The address that reads as one host and resolves as another.
	assert.equal(parseDeepLink('wpct://ticket@evil/62281').reason, REFUSAL_REASONS.UNKNOWN_HOST);
	assert.equal(parseDeepLink('wpct://user:pw@ticket/62281').reason, REFUSAL_REASONS.UNKNOWN_HOST);
	// A port is part of the authority, so it is named as a host problem rather
	// than as a malformed ticket. Log wording, but the log is how a refusal is
	// ever noticed.
	assert.equal(parseDeepLink('wpct://ticket:80/62281').reason, REFUSAL_REASONS.UNKNOWN_HOST);
});

test('how the scheme is claimed with the OS, per platform', () => {
	// Packaged: the scheme name is the whole call. On macOS and Linux the
	// installer has already registered it; on Windows this is the registration.
	assert.deepEqual(
		protocolRegistration({ isPackaged: true, platform: 'darwin', execPath: '/e', appPath: '/a' }),
		{ scheme: DEEP_LINK_SCHEME }
	);
	assert.deepEqual(
		protocolRegistration({ isPackaged: true, platform: 'win32', execPath: '/e', appPath: '/a' }),
		{ scheme: DEEP_LINK_SCHEME }
	);

	// From source, only Windows can be claimed at all: `path` and `args` are a
	// Windows-only form, and macOS needs the scheme in a bundle's Info.plist,
	// which cannot be written at runtime.
	assert.deepEqual(
		protocolRegistration({ isPackaged: false, platform: 'win32', execPath: 'C:\\electron.exe', appPath: 'C:\\repo' }),
		{ scheme: DEEP_LINK_SCHEME, execPath: 'C:\\electron.exe', args: ['C:\\repo'] }
	);
	assert.equal(protocolRegistration({ isPackaged: false, platform: 'darwin', execPath: '/e', appPath: '/a' }), null);
	assert.equal(protocolRegistration({ isPackaged: false, platform: 'linux', execPath: '/e', appPath: '/a' }), null);

	// The app path is the one thing this must not guess. It comes from
	// `app.getAppPath()`; an empty one is no registration rather than a handler
	// pointing at nothing that reports success.
	assert.equal(protocolRegistration({ isPackaged: false, platform: 'win32', execPath: 'C:\\electron.exe', appPath: '' }), null);
	assert.equal(protocolRegistration(), null);
});

test('the id goes through the app\'s own definition of a ticket', () => {
	assert.equal(parseDeepLink('wpct://ticket/0').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/99999999999').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/1e3').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/').reason, REFUSAL_REASONS.NOT_A_TICKET);
	assert.equal(parseDeepLink('wpct://ticket/-1').reason, REFUSAL_REASONS.NOT_A_TICKET);
});

test('input that is not an address at all', () => {
	assert.equal(parseDeepLink('').reason, REFUSAL_REASONS.NOT_A_STRING);
	assert.equal(parseDeepLink('   ').reason, REFUSAL_REASONS.NOT_A_STRING);
	assert.equal(parseDeepLink(null).reason, REFUSAL_REASONS.NOT_A_STRING);
	assert.equal(parseDeepLink(62281).reason, REFUSAL_REASONS.NOT_A_STRING);
	assert.equal(parseDeepLink({ href: 'wpct://ticket/1' }).reason, REFUSAL_REASONS.NOT_A_STRING);
	// An empty authority parses; it is simply not the host this app answers.
	assert.equal(parseDeepLink('wpct://').reason, REFUSAL_REASONS.UNKNOWN_HOST);
	// An address the URL parser itself rejects never reaches the host check.
	assert.equal(parseDeepLink('wpct://ticket:not-a-port/1').reason, REFUSAL_REASONS.UNPARSEABLE);
});

test('the address is picked out of a command line', () => {
	// How it arrives on Windows and Linux: appended to argv, after the
	// executable and Electron's own switches.
	assert.equal(pickDeepLinkArg(['C:\\app.exe', '--foo', 'wpct://ticket/7']), 'wpct://ticket/7');
	assert.equal(pickDeepLinkArg(['/app', 'WPCT://ticket/7']), 'WPCT://ticket/7');
	// A second one is not a second request to honour.
	assert.equal(pickDeepLinkArg(['/app', 'wpct://ticket/7', 'wpct://ticket/9']), 'wpct://ticket/7');
	assert.equal(pickDeepLinkArg(['/app', '--no-sandbox']), null);
	assert.equal(pickDeepLinkArg([]), null);
	assert.equal(pickDeepLinkArg(undefined), null);
	assert.equal(pickDeepLinkArg(['/app', null, 'wpct://ticket/7']), 'wpct://ticket/7');
});

test('a ticket is delivered, a refusal is only logged', () => {
	const rec = recorder();
	assert.equal(handleDeepLink('wpct://ticket/62281', rec.effects), true);
	assert.deepEqual(rec.tickets, [62281]);
	assert.deepEqual(rec.refused, []);

	assert.equal(handleDeepLink('wpct://evil/1', rec.effects), false);
	assert.deepEqual(rec.tickets, [62281], 'a refused address must not reach the renderer');
	assert.equal(rec.refused.length, 1);
	assert.ok(rec.refused[0].startsWith(`${REFUSAL_REASONS.UNKNOWN_HOST}: `));
});

test('a refused address reaches the log on one bounded line', () => {
	const rec = recorder();
	handleDeepLink(`wpct://evil/\n${'x'.repeat(500)}`, rec.effects);
	assert.equal(rec.refused.length, 1);
	assert.ok(!rec.refused[0].includes('\n'), 'a newline would let the value write a log entry of its own');
	assert.ok(rec.refused[0].endsWith('…'));
});

test('handleDeepLink needs no onRefused', () => {
	// main.js always passes one; a caller that does not must not throw its way
	// out of an event handler the OS is waiting on.
	assert.equal(handleDeepLink('wpct://evil/1', { onTicket: () => {} }), false);
});

// --- the queue -----------------------------------------------------------
//
// The cold-start path, and the one most likely to break: the ticket is in hand
// before there is a page to send it to, and a send to a page still loading is
// dropped without a sound.

test('a ticket that arrives before the renderer is kept, not handed out', () => {
	const queue = createDeepLinkQueue();
	const sent = [];
	const send = (ticket) => { sent.push(ticket); };
	queue.hold(62281);

	assert.equal(queue.deliver(send), null, 'nobody is listening yet');
	assert.deepEqual(sent, [], 'and nothing may be sent into a page that has not subscribed');
	assert.equal(queue.waiting(), 62281, 'and the ticket must still be there');

	queue.markReady();
	assert.equal(queue.deliver(send), 62281);
	assert.deepEqual(sent, [62281]);
});

test('a ticket is handed out once', () => {
	const queue = createDeepLinkQueue();
	const sent = [];
	const send = (ticket) => { sent.push(ticket); };
	queue.markReady();
	queue.hold(62281);

	assert.equal(queue.deliver(send), 62281);
	assert.equal(queue.deliver(send), null, 'a second flush must not deliver it again');
	assert.deepEqual(sent, [62281]);
	assert.equal(queue.waiting(), null);
});

test('a send that fails keeps the ticket', () => {
	// The window can go between the check that it exists and the send. Clearing
	// first and sending after would consume the ticket into that failure, which
	// is the same silent loss as sending into a loading page, in a narrower
	// window.
	const queue = createDeepLinkQueue();
	queue.markReady();
	queue.hold(62281);

	assert.throws(() => queue.deliver(() => { throw new Error('window is gone'); }), /window is gone/);
	assert.equal(queue.waiting(), 62281, 'the ticket must survive a send that did not land');

	const sent = [];
	assert.equal(queue.deliver((ticket) => { sent.push(ticket); }), 62281, 'and the next window gets it');
	assert.deepEqual(sent, [62281]);
});

test('nothing waiting is not something to deliver', () => {
	const queue = createDeepLinkQueue();
	const sent = [];
	const send = (ticket) => { sent.push(ticket); };
	assert.equal(queue.deliver(send), null);
	queue.markReady();
	assert.equal(queue.deliver(send), null);
	assert.deepEqual(sent, []);
});

test('two links before the app is up are one answer, the last', () => {
	// A contributor changing their mind, not two tickets to open.
	const queue = createDeepLinkQueue();
	const sent = [];
	const send = (ticket) => { sent.push(ticket); };
	queue.hold(62281);
	queue.hold(49215);
	queue.markReady();

	assert.equal(queue.deliver(send), 49215);
	assert.equal(queue.deliver(send), null);
	assert.deepEqual(sent, [49215]);
});

test('a new window waits for its own page to subscribe', () => {
	// macOS: the window is closed, the app lives on, a link reopens it. The
	// ticket held across that must not be sent into the page while it loads.
	const queue = createDeepLinkQueue();
	const sent = [];
	const send = (ticket) => { sent.push(ticket); };
	queue.markReady();
	queue.hold(62281);
	queue.reset();

	assert.equal(queue.deliver(send), null, 'the new page has not subscribed yet');
	assert.deepEqual(sent, []);
	assert.equal(queue.waiting(), 62281);

	queue.markReady();
	assert.equal(queue.deliver(send), 62281);
	assert.deepEqual(sent, [62281]);
});

/**
 * Stands in for the send to the renderer and the log line, so "did this reach
 * the window?" is an assertion rather than something the test takes on trust.
 *
 * @return {{tickets: number[], refused: string[], effects: Object}}
 */
function recorder() {
	const tickets = [];
	const refused = [];
	return {
		tickets,
		refused,
		effects: {
			onTicket: (ticket) => { tickets.push(ticket); },
			onRefused: (message) => { refused.push(message); }
		}
	};
}
