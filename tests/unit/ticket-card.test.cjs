const test = require('node:test');
const assert = require('node:assert/strict');

const { ticketCardWords, ticketFacts, pullRequestState, pullRequestRows, pullRequestGroups, pullRequestsStatus, attachmentRows, attachmentGroups, attachmentsStatus, tracReadAt, tracReadToShow, ticketHeading } = require('../../src/renderer/ticket-card.cjs');

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
	opened: { relative: '4 weeks ago', absolute: '09/01/2026 10:00:00 AM' }
};

test('a ticket that has not been read has no facts', () => {
	assert.equal(ticketFacts(null), null);
	assert.equal(ticketFacts(undefined), null);
});

test('a ticket\'s facts are its summary, its status, and one labelled row per fact', () => {
	assert.deepEqual(ticketFacts(INFO), {
		summary: 'Inconsistent documentation',
		status: { label: 'reviewing', intent: 'informational' },
		facts: [
			{ id: 'type', label: 'Type', value: 'defect (bug)' },
			{ id: 'component', label: 'Component', value: 'General', url: 'https://core.trac.wordpress.org/query?component=General' },
			{ id: 'milestone', label: 'Milestone', value: '7.2' },
			{ id: 'opened', label: 'Opened', value: '09/01/2026 10:00:00 AM' },
			{ id: 'keywords', label: 'Keywords', links: INFO.keywords }
		]
	});
});

test('a closed ticket says how it was closed, and is not dressed as an error', () => {
	const closed = ticketFacts({ ...INFO, status: 'closed', resolution: 'wontfix' });
	assert.deepEqual(closed.status, { label: 'closed (wontfix)', intent: 'none' });
});

test('a fact Trac did not give is left out, not shown empty', () => {
	const bare = ticketFacts({ summary: '', status: '', type: '', milestone: '', component: null, keywords: [], opened: null });
	assert.deepEqual(bare, { summary: '', status: null, facts: [] });
	// A component with no page to go to is still said.
	assert.deepEqual(ticketFacts({ ...INFO, component: { label: 'General' } }).facts[1], { id: 'component', label: 'Component', value: 'General', url: '' });
	assert.equal(ticketFacts({ ...INFO, keywords: undefined }).facts.some((fact) => fact.id === 'keywords'), false);
	// With no date given, Trac's "4 weeks ago" is all there is to say.
	assert.deepEqual(ticketFacts({ ...INFO, opened: { relative: '4 weeks ago', absolute: '' } }).facts[3], { id: 'opened', label: 'Opened', value: '4 weeks ago' });
	// And with neither, not "Opened" and nothing.
	assert.equal(ticketFacts({ ...INFO, opened: { relative: '', absolute: '' } }).facts.some((fact) => fact.id === 'opened'), false);
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

const keysOf = (entry) => (entry ? entry.row.key : null);

test('the newest pull request is shown, and the rest are grouped open and closed, the group it would have been in saying "other" (#709)', () => {
	const items = [
		{ number: 4, url: 'u4', state: 'open' },
		{ number: 3, url: 'u3', state: 'merged' },
		{ number: 2, url: 'u2', state: 'draft' },
		{ number: 1, url: 'u1', state: 'CLOSED' }
	];
	const { applied, newest, groups } = pullRequestGroups(pullRequestRows({ items }), items);
	assert.equal(applied, null);
	assert.equal(keysOf(newest), 4);
	assert.deepEqual(groups.map((group) => [group.key, group.label]), [['open', 'Other open PRs (1)'], ['closed', 'Closed PRs (2)']]);
	// Each row keeps its pull request, newest first.
	assert.deepEqual(groups[1].entries.map((entry) => [entry.row.key, entry.item.number]), [[3, 3], [1, 1]]);
});

test('a closed newest makes the closed group the "other" one', () => {
	const items = [{ number: 2, url: 'u2', state: 'merged' }, { number: 1, url: 'u1', state: 'open' }];
	const { newest, groups } = pullRequestGroups(pullRequestRows({ items }), items);
	assert.equal(keysOf(newest), 2);
	assert.deepEqual(groups.map((group) => group.label), ['Open PRs (1)']);
	const three = [...items, { number: 0, url: 'u0', state: 'closed' }];
	assert.deepEqual(pullRequestGroups(pullRequestRows({ items: three }), three).groups.map((group) => group.label), ['Open PRs (1)', 'Other closed PRs (1)']);
});

test('the ticket\'s latest patch, when it is a pull request, is the one shown, wherever it is in the list', () => {
	const items = [{ number: 3, url: 'u3', state: 'open' }, { number: 2, url: 'u2', state: 'closed' }, { number: 1, url: 'u1', state: 'open' }];
	const { newest, groups } = pullRequestGroups(pullRequestRows({ items, latest: { kind: 'pr', key: 2 } }), items);
	assert.equal(keysOf(newest), 2);
	assert.deepEqual(groups.map((group) => group.label), ['Open PRs (2)']);
});

test('with a pull request checked out it is the only one shown, and every other is in the groups', () => {
	const items = [{ number: 3, url: 'u3', state: 'open' }, { number: 2, url: 'u2', state: 'closed' }, { number: 1, url: 'u1', state: 'open' }];
	const { applied, newest, groups } = pullRequestGroups(pullRequestRows({ items, appliedNumber: 1, latest: { kind: 'pr', key: 3 } }), items, { workApplied: true });
	assert.deepEqual([keysOf(applied), applied.item.number, newest], [1, 1, null]);
	assert.deepEqual(groups.map((group) => group.label), ['Other open PRs (1)', 'Closed PRs (1)']);
});

test('with something applied from elsewhere, no pull request is shown above the groups', () => {
	const items = [{ number: 2, url: 'u2', state: 'open' }, { number: 1, url: 'u1', state: 'closed' }];
	const { applied, newest, groups } = pullRequestGroups(pullRequestRows({ items, latest: { kind: 'pr', key: 2 } }), items, { workApplied: true });
	assert.deepEqual([applied, newest], [null, null]);
	assert.deepEqual(groups.map((group) => group.label), ['Open PRs (1)', 'Closed PRs (1)']);
});

test('a pull request\'s group always agrees with its badge', () => {
	const states = ['open', 'merged', 'closed', 'MERGED', 'draft', '', undefined];
	const items = [{ number: 99, url: 'u', state: 'open' }, ...states.map((state, index) => ({ number: index + 1, url: `u${index}`, state }))];
	const rows = pullRequestRows({ items });
	const { groups } = pullRequestGroups(rows, items);
	const closed = new Set(groups.filter((group) => group.key === 'closed').flatMap((group) => group.entries.map((entry) => entry.row.key)));
	for (const row of rows.slice(1)) assert.equal(closed.has(row.key), row.state.label !== 'Open', `#${row.key}`);
});

test('a lone pull request is shown with no group, and none leaves nothing', () => {
	const items = [{ number: 1, url: 'u', state: 'closed' }];
	const { newest, groups } = pullRequestGroups(pullRequestRows({ items }), items);
	assert.deepEqual([keysOf(newest), groups], [1, []]);
	assert.deepEqual(pullRequestGroups(), { applied: null, newest: null, groups: [] });
});

test('a first read of the pull requests says it is asking, and a later one does not', () => {
	assert.deepEqual(pullRequestsStatus({ loading: true }), { checking: true, empty: false, failure: null });
	// A refresh keeps what it had on screen.
	assert.equal(pullRequestsStatus({ loading: true, list: { status: 'ok', items: [] } }).checking, false);
	assert.deepEqual(pullRequestsStatus(), { checking: false, empty: false, failure: null });
});

test('a list GitHub answered with nothing in it says so, and only then', () => {
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [] } }).empty, true);
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [{ number: 1 }] } }).empty, false);
	assert.equal(pullRequestsStatus({ list: { status: 'offline', items: [] } }).empty, false);
});

test('a list that could not be read says why, and what is shown in its place', () => {
	const at = () => 'yesterday at noon';
	const cached = { items: [{ number: 1 }], cachedAt: 1790000000000 };
	const seen = 'Showing what was last seen yesterday at noon.';
	const none = 'No cached list to fall back on.';
	assert.deepEqual(pullRequestsStatus({ list: { status: 'rate-limited', ...cached }, formatDateTime: at }).failure, { reason: 'GitHub is rate-limiting this connection.', fallback: seen });
	assert.deepEqual(pullRequestsStatus({ list: { status: 'offline', ...cached }, formatDateTime: at }).failure, { reason: 'Could not reach GitHub.', fallback: seen });
	assert.deepEqual(pullRequestsStatus({ list: { status: 'error', items: [] } }).failure, { reason: 'Could not read the pull requests from GitHub.', fallback: none });
	// An answer nobody has a sentence for is still said as a failure.
	assert.deepEqual(pullRequestsStatus({ list: { status: 'teapot' } }).failure, { reason: 'Could not read the pull requests from GitHub.', fallback: none });
	// Rows with no time to say they are from is not a cache to name, and
	// neither is a time with no rows.
	assert.equal(pullRequestsStatus({ list: { status: 'offline', items: [{ number: 1 }] } }).failure.fallback, none);
	assert.equal(pullRequestsStatus({ list: { status: 'offline', items: [], cachedAt: 1790000000000 } }).failure.fallback, none);
});

test('a site with nothing linked, and a list that was read, are not failures', () => {
	assert.equal(pullRequestsStatus({ list: { status: 'no-ticket' } }).failure, null);
	assert.equal(pullRequestsStatus({ list: { status: 'ok', items: [] } }).failure, null);
});

test('an attachment\'s row says who uploaded it, when and how large, as far as Trac said', () => {
	const items = [
		{ url: 'https://core.trac.wordpress.org/attachment/ticket/65933/65933.diff', filename: '65933.diff', author: 'someone', dateText: '6 weeks ago', sizeText: '3.2 KB' },
		{ url: 'https://core.trac.wordpress.org/attachment/ticket/65933/65933.2.diff', filename: '65933.2.diff', sizeText: '2.8 KB' }
	];
	assert.deepEqual(attachmentRows({ items, latest: { kind: 'attachment', key: items[1].url } }), [
		{ key: items[0].url, name: '65933.diff', url: items[0].url, latest: false, applied: false, meta: 'by someone · 6 weeks ago · 3.2 KB' },
		{ key: items[1].url, name: '65933.2.diff', url: items[1].url, latest: true, applied: false, meta: '2.8 KB' }
	]);
	assert.equal(attachmentRows({ items, latest: { kind: 'pr', key: items[1].url } })[1].latest, false);
	assert.deepEqual(attachmentRows(), []);
});

test('an attachment is marked applied when the site\'s applied patch is that file', () => {
	const items = [{ filename: '1.diff', url: 'u1' }, { filename: '2.diff', url: 'u2' }];
	assert.deepEqual(attachmentRows({ items, appliedLabel: '2.diff' }).map((row) => row.applied), [false, true]);
	assert.deepEqual(attachmentRows({ items, appliedLabel: 'PR #7' }).map((row) => row.applied), [false, false]);
	assert.deepEqual(attachmentRows({ items }).map((row) => row.applied), [false, false]);
});

test('the newest attachment is shown, and the rest are one group, newest first, counted (#709)', () => {
	const items = [1, 2, 3, 4].map((n) => ({ filename: `${n}.diff`, url: `u${n}` }));
	const { applied, newest, groups } = attachmentGroups(attachmentRows({ items }), items);
	assert.equal(applied, null);
	assert.equal(newest.item.filename, '4.diff');
	assert.deepEqual(groups.map((group) => [group.key, group.label]), [['other', 'Other attachments (3)']]);
	// Newest first, as the pull requests are, where Trac lists oldest first.
	assert.deepEqual(groups[0].entries.map((entry) => [entry.row.name, entry.item.filename]), [['3.diff', '3.diff'], ['2.diff', '2.diff'], ['1.diff', '1.diff']]);
});

test('with an attachment applied it is the only one shown, and with something applied elsewhere none is', () => {
	const items = [1, 2, 3, 4].map((n) => ({ filename: `${n}.diff`, url: `u${n}` }));
	const here = attachmentGroups(attachmentRows({ items, latest: { kind: 'attachment', key: 'u4' }, appliedLabel: '2.diff' }), items, { workApplied: true });
	assert.deepEqual([here.applied.item.filename, here.newest], ['2.diff', null]);
	assert.deepEqual(here.groups.map((group) => [group.label, group.entries.map((entry) => entry.item.filename)]), [['Other attachments (3)', ['4.diff', '3.diff', '1.diff']]]);
	const elsewhere = attachmentGroups(attachmentRows({ items }), items, { workApplied: true });
	assert.deepEqual([elsewhere.applied, elsewhere.newest], [null, null]);
	assert.deepEqual(elsewhere.groups.map((group) => group.label), ['Attachments (4)']);
});

test('with nothing left over there is no group', () => {
	const items = [{ filename: '1.diff', url: 'u1' }];
	assert.deepEqual(attachmentGroups(attachmentRows({ items }), items).groups, []);
	const applied = attachmentGroups(attachmentRows({ items, appliedLabel: '1.diff' }), items, { workApplied: true });
	assert.deepEqual([applied.applied.item.filename, applied.newest, applied.groups], ['1.diff', null, []]);
	assert.deepEqual(attachmentGroups(), { applied: null, newest: null, groups: [] });
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
	// An answer the card has no sentence for is not a failure it can name,
	// and is not "none" either: nothing was read.
	assert.deepEqual(attachmentsStatus({ result: { status: 'not-trac' } }), { unread: false, reading: false, none: false, failure: '' });
});

// A relaunch shows the last read and not a new one (#695), so the card says
// when it was.
test('the details say when they were read from Trac, and nothing before a read', () => {
	const at = () => 'yesterday at noon';
	assert.equal(tracReadAt({ checkedAt: '2026-10-18T12:00:00.000Z', formatDateTime: at }), 'Read from Trac yesterday at noon');
	assert.equal(tracReadAt({ checkedAt: null, formatDateTime: at }), '');
	assert.equal(tracReadAt(), '');
});

test('the saved read is shown only while its ticket is linked, and never over a read that answered', () => {
	const saved = { status: 'ok', checkedAt: '2026-10-18T12:00:00.000Z' };
	const fresh = { status: 'ok', checkedAt: '2026-10-19T09:00:00.000Z' };
	assert.equal(tracReadToShow({ current: null, saved, sameTicket: true }), saved);
	assert.equal(tracReadToShow({ current: fresh, saved, sameTicket: true }), fresh, 'a read that answered first is newer');
	assert.equal(tracReadToShow({ current: null, saved, sameTicket: false }), null, 'another ticket is linked now');
	assert.equal(tracReadToShow({ current: null, saved: null, sameTicket: true }), null);
});

// The heading's three states. Under #108 the number names the branch, so a
// screen reader hears it first in every one of them.
test('the heading leads with the summary once Trac gave one, and is the number before', () => {
	const read = ticketFacts(INFO);
	assert.deepEqual(ticketHeading({ ticketId: 60001, facts: read }), {
		numberAbove: '#60001',
		status: { label: 'reviewing', intent: 'informational' },
		hiddenPrefix: '#60001 ',
		linkText: 'Inconsistent documentation'
	});
	// Not read yet: the number is the heading, with nothing above it.
	assert.deepEqual(ticketHeading({ ticketId: 60001, facts: null }), { numberAbove: '', status: null, hiddenPrefix: '', linkText: '#60001' });
	// Read, but Trac gave no summary: the number stays the heading, and the
	// status still shows above it.
	assert.deepEqual(ticketHeading({ ticketId: 60001, facts: ticketFacts({ ...INFO, summary: '' }) }), {
		numberAbove: '',
		status: { label: 'reviewing', intent: 'informational' },
		hiddenPrefix: '',
		linkText: '#60001'
	});
});
