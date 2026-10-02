const test = require('node:test');
const assert = require('node:assert/strict');

const { ticketCardWords, ticketFacts, pullRequestState, pullRequestRows, pullRequestsStatus, attachmentRows, attachmentsStatus } = require('../../src/renderer/ticket-card.cjs');

test('a Core site\'s card is about a Trac ticket, and a Gutenberg site\'s about a GitHub issue', () => {
	const trac = ticketCardWords('trac');
	assert.equal(trac.title, 'Trac ticket');
	assert.equal(trac.fieldLabel, 'Ticket number or URL');
	assert.equal(trac.linkAction, 'Link ticket');
	assert.equal(trac.browse, 'Browse good first bugs on Trac');
	const issue = ticketCardWords('github-issue');
	assert.equal(issue.title, 'GitHub issue');
	assert.equal(issue.fieldLabel, 'Issue number or URL');
	assert.equal(issue.linkAction, 'Link issue');
	assert.equal(issue.browse, 'Browse good first issues on GitHub');
	// The two say the same things: a word one has and the other lacks would
	// be drawn as nothing.
	assert.deepEqual(Object.keys(issue).sort(), Object.keys(trac).sort());
	// Neither borrows the other's noun.
	for (const text of Object.values(issue)) assert.doesNotMatch(text, /ticket|Trac/);
	for (const text of Object.values(trac)) assert.doesNotMatch(text, /issue/i);
});

test('anything that is not a GitHub issue is a Trac ticket, as the provider has it', () => {
	assert.deepEqual(ticketCardWords(undefined), ticketCardWords('trac'));
	assert.deepEqual(ticketCardWords('something-else'), ticketCardWords('trac'));
});

const INFO = {
	summary: 'Inconsistent documentation',
	status: 'reviewing',
	resolution: '',
	type: 'defect (bug)',
	milestone: '7.2',
	component: { label: 'General', url: 'https://core.trac.wordpress.org/query?component=General' },
	keywords: [{ label: 'has-patch', url: 'https://core.trac.wordpress.org/query?keywords=~has-patch' }],
	opened: { relative: '4 weeks ago', absolute: '2026-09-01T10:00:00Z' }
};

test('a ticket that has not been read has no facts', () => {
	assert.equal(ticketFacts(null), null);
	assert.equal(ticketFacts(undefined), null);
});

test('a ticket\'s facts are its summary, its status, and a line of what Trac said', () => {
	assert.deepEqual(ticketFacts(INFO), {
		summary: 'Inconsistent documentation',
		status: { label: 'reviewing', intent: 'informational' },
		facts: [
			{ id: 'type', text: 'defect (bug)' },
			{ id: 'component', text: 'General', url: 'https://core.trac.wordpress.org/query?component=General' },
			{ id: 'milestone', text: 'Milestone: 7.2' },
			{ id: 'opened', text: 'Opened 4 weeks ago', title: '2026-09-01T10:00:00Z' }
		],
		keywords: INFO.keywords
	});
});

test('a closed ticket says how it was closed, and is not dressed as an error', () => {
	const closed = ticketFacts({ ...INFO, status: 'closed', resolution: 'wontfix' });
	assert.deepEqual(closed.status, { label: 'closed (wontfix)', intent: 'none' });
});

test('a fact Trac did not give is left out, not shown empty', () => {
	const bare = ticketFacts({ summary: '', status: '', type: '', milestone: '', component: null, keywords: [], opened: null });
	assert.deepEqual(bare, { summary: '', status: null, facts: [], keywords: [] });
	// A component with no page to go to is still said.
	assert.deepEqual(ticketFacts({ ...INFO, component: { label: 'General' } }).facts[1], { id: 'component', text: 'General', url: '' });
	assert.deepEqual(ticketFacts({ ...INFO, keywords: undefined }).keywords, []);
});

// The rule the three badges are chosen under (#227): the colour goes with
// the word and never replaces it, and a closed pull request is not a failure.
test('each state of a pull request has its own word, and closed has no colour', () => {
	assert.deepEqual(pullRequestState('open'), { label: 'Open', intent: 'stable' });
	assert.deepEqual(pullRequestState('merged'), { label: 'Merged', intent: 'informational' });
	assert.deepEqual(pullRequestState('closed'), { label: 'Closed', intent: 'none' });
	assert.deepEqual(pullRequestState('MERGED'), pullRequestState('merged'));
	const labels = ['open', 'merged', 'closed'].map((state) => pullRequestState(state).label);
	assert.equal(new Set(labels).size, 3);
	// Red is what "something failed" looks like in this window.
	assert.notEqual(pullRequestState('closed').intent, 'high');
});

test('an unknown or missing state reads as open, the way the row has always behaved (issue #227)', () => {
	for (const state of ['draft', '', undefined, null, 7]) {
		assert.deepEqual(pullRequestState(state), pullRequestState('open'));
	}
});

const day = (iso) => iso.slice(0, 10);

test('a pull request\'s row says its number, state and date, and whether it is the latest or the one checked out', () => {
	const items = [
		{ number: 13245, url: 'https://github.com/WordPress/wordpress-develop/pull/13245', title: 'Docs: correct the default', state: 'open', commitDate: '2026-08-24T09:00:00Z', updatedAt: '2026-08-25T09:00:00Z' },
		{ number: 13012, url: 'https://github.com/WordPress/wordpress-develop/pull/13012', title: 'Docs: list the values', state: 'closed', updatedAt: '2026-06-11T09:00:00Z' },
		{ number: 12999, url: 'https://github.com/WordPress/wordpress-develop/pull/12999', state: 'merged' }
	];
	const rows = pullRequestRows({ items, latest: { kind: 'pr', key: 13245 }, appliedNumber: 13012, formatDate: day });
	assert.deepEqual(rows, [
		{ key: 13245, id: '#13245', url: items[0].url, title: 'Docs: correct the default', state: { label: 'Open', intent: 'stable' }, latest: true, applied: false, date: 'Last commit 2026-08-24' },
		{ key: 13012, id: '#13012', url: items[1].url, title: 'Docs: list the values', state: { label: 'Closed', intent: 'none' }, latest: false, applied: true, date: 'Updated 2026-06-11' },
		{ key: 12999, id: '#12999', url: items[2].url, title: '', state: { label: 'Merged', intent: 'informational' }, latest: false, applied: false, date: '' }
	]);
});

test('the latest patch being an attachment marks no pull request, and no checkout marks none as applied', () => {
	const items = [{ number: 5, url: 'u', title: 't', state: 'open' }];
	assert.equal(pullRequestRows({ items, latest: { kind: 'attachment', key: 5 } })[0].latest, false);
	assert.equal(pullRequestRows({ items })[0].latest, false);
	assert.equal(pullRequestRows({ items })[0].applied, false);
	assert.deepEqual(pullRequestRows(), []);
	assert.deepEqual(pullRequestRows({ items: null }), []);
});

test('a first read of the pull requests says it is asking, and a later one does not', () => {
	assert.deepEqual(pullRequestsStatus({ loading: true }), { checking: true, empty: false, failure: '' });
	// A refresh keeps what it had on screen.
	assert.equal(pullRequestsStatus({ loading: true, list: { status: 'ok', items: [] } }).checking, false);
	assert.deepEqual(pullRequestsStatus(), { checking: false, empty: false, failure: '' });
});

test('a list GitHub answered with nothing in it says so, and only then', () => {
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [] } }).empty, true);
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [{ number: 1 }] } }).empty, false);
	assert.equal(pullRequestsStatus({ list: { status: 'offline', items: [] } }).empty, false);
});

test('a list that could not be read says why, and what is shown in its place', () => {
	const at = () => 'yesterday at noon';
	const cached = { items: [{ number: 1 }], cachedAt: 1790000000000 };
	assert.equal(pullRequestsStatus({ list: { status: 'rate-limited', ...cached }, formatDateTime: at }).failure, 'GitHub is rate-limiting this connection. Showing what was last seen yesterday at noon.');
	assert.equal(pullRequestsStatus({ list: { status: 'offline', ...cached }, formatDateTime: at }).failure, 'Could not reach GitHub. Showing what was last seen yesterday at noon.');
	assert.equal(pullRequestsStatus({ list: { status: 'error', items: [] } }).failure, 'Could not read the pull requests from GitHub. No cached list to fall back on.');
	// An answer nobody has a sentence for is still said as a failure.
	assert.equal(pullRequestsStatus({ list: { status: 'teapot' } }).failure, 'Could not read the pull requests from GitHub. No cached list to fall back on.');
	// Rows with no time to say they are from is not a cache to name.
	assert.match(pullRequestsStatus({ list: { status: 'offline', items: [{ number: 1 }] } }).failure, /No cached list to fall back on\.$/);
});

test('a site with nothing linked, and a list that was read, are not failures', () => {
	assert.equal(pullRequestsStatus({ list: { status: 'no-ticket' } }).failure, '');
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [] } }).failure, '');
});

test('an attachment\'s row says who uploaded it, when and how large, as far as Trac said', () => {
	const items = [
		{ url: 'https://core.trac.wordpress.org/attachment/ticket/65933/65933.diff', filename: '65933.diff', author: 'someone', dateText: '6 weeks ago', sizeText: '3.2 KB' },
		{ url: 'https://core.trac.wordpress.org/attachment/ticket/65933/65933.2.diff', filename: '65933.2.diff', sizeText: '2.8 KB' }
	];
	assert.deepEqual(attachmentRows({ items, latest: { kind: 'attachment', key: items[1].url } }), [
		{ key: items[0].url, name: '65933.diff', url: items[0].url, latest: false, meta: 'by someone · 6 weeks ago · 3.2 KB' },
		{ key: items[1].url, name: '65933.2.diff', url: items[1].url, latest: true, meta: '2.8 KB' }
	]);
	assert.equal(attachmentRows({ items, latest: { kind: 'pr', key: items[1].url } })[1].latest, false);
	assert.deepEqual(attachmentRows(), []);
});

test('the attachments are unread until Trac has been asked, and reading while it is', () => {
	assert.deepEqual(attachmentsStatus(), { unread: true, reading: false, none: false, failure: '' });
	assert.deepEqual(attachmentsStatus({ loading: true }), { unread: false, reading: true, none: false, failure: '' });
});

test('a ticket read with no patch file on it says so, and one that failed to be read does not', () => {
	assert.equal(attachmentsStatus({ result: { status: 'no-attachments' } }).none, true);
	assert.equal(attachmentsStatus({ result: { status: 'ok' }, count: 0 }).none, true);
	assert.equal(attachmentsStatus({ result: { status: 'ok' }, count: 2 }).none, false);
	assert.equal(attachmentsStatus({ result: { status: 'error' } }).none, false);
});

test('each way the read can end without an answer has its own sentence', () => {
	const timeout = attachmentsStatus({ result: { status: 'challenge-timeout' } }).failure;
	const closed = attachmentsStatus({ result: { status: 'closed' } }).failure;
	const error = attachmentsStatus({ result: { status: 'error' } }).failure;
	assert.match(timeout, /human-check did not complete in time/);
	assert.match(closed, /window was closed/);
	// It names the button that is there to press after a read has failed.
	assert.match(closed, /Click “Refresh” to try again\.$/);
	assert.equal(error, 'Could not read the attachments from Trac.');
	assert.equal(attachmentsStatus({ result: { status: 'error', error: 'net::ERR_FAILED' } }).failure, 'Could not read the attachments from Trac. (net::ERR_FAILED)');
	assert.equal(new Set([timeout, closed, error]).size, 3);
	assert.equal(attachmentsStatus({ result: { status: 'ok' } }).failure, '');
});
