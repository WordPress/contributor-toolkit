'use strict';

// A ticket's own properties, parsed off its page (issue #292).
//
// The fixtures are the `#ticket` blocks of two real core Trac tickets, taken
// from archived copies of the live pages — #59234 (open, with milestone,
// component and keywords) and #40000 (closed wontfix) — so the regexes are
// proven against markup Trac actually emits, not markup remembered.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTicketInfo, statusBadge } = require('../src/trac-ticket-info.cjs');

const OPEN_TICKET = '<div id="ticket" class="trac-content ">\n  <div class="date">\n    <p>Opened <a class="timeline" href="/timeline?from=2023-08-28T23%3A50%3A14Z&amp;precision=second" title="See timeline at 08/28/2023 11:50:14 PM">18 months ago</a></p>\n    <p>Last modified <a class="timeline" href="/timeline?from=2024-02-12T14%3A03%3A01Z&amp;precision=second" title="See timeline at 02/12/2024 02:03:01 PM">12 months ago</a></p>\n  </div>\n  <h2>\n    <a href="/ticket/59234" class="trac-id">#59234</a>\n    <span class="trac-status">\n      <a href="/query?status=new">new</a>\n    </span>\n    <span class="trac-type">\n      <a href="/query?status=!closed&amp;type=enhancement">enhancement</a>\n    </span>\n  </h2>\n  <h1 id="trac-ticket-title" class="searchable">\n    <span class="summary">Introduce a `wp_json_decode()` function, including validation when available</span>\n  </h1>\n  <table class="properties">\n    <tr>\n      <th id="h_reporter">Reported by:</th>\n      <td headers="h_reporter" class="searchable">\n  <a href="https://profiles.wordpress.org/jrf" data-nicename="jrf">\n    <img class="avatar" src="https://wordpress.org/grav-redirect.php?user=jrf&amp;s=48" srcset="https://wordpress.org/grav-redirect.php?user=jrf&amp;s=96 2x" height="48" width="48" alt="jrf\'s profile" />\n  </a>\n    <a class="trac-author" href="/query?status=!closed&amp;reporter=jrf">jrf</a>\n</td>\n      <th id="h_owner" class="missing">Owned by:</th>\n      <td headers="h_owner">\n</td>\n    </tr>\n    <tr>\n        <th id="h_milestone">\n          Milestone:\n        </th>\n        <td headers="h_milestone">\n              <a class="milestone" href="/milestone/Future%20Release" title="No date set">Future Release</a>\n        </td>\n        <th id="h_priority">\n          Priority:\n        </th>\n        <td headers="h_priority">\n              <a href="/query?status=!closed&amp;priority=normal">normal</a>\n        </td>\n    </tr><tr>\n        <th id="h_severity">\n          Severity:\n        </th>\n        <td headers="h_severity">\n              <a href="/query?status=!closed&amp;severity=normal">normal</a>\n        </td>\n        <th id="h_version">\n          Version:\n        </th>\n        <td headers="h_version">\n              <a href="/query?status=!closed&amp;version=6.4">6.4</a>\n        </td>\n    </tr><tr>\n        <th id="h_component">\n          Component:\n        </th>\n        <td headers="h_component">\n              <a href="/query?status=!closed&amp;component=General">General</a>\n        </td>\n        <th id="h_keywords">\n          Keywords:\n        </th>\n        <td headers="h_keywords" class="searchable">\n              <a href="/query?status=!closed&amp;keywords=~php83">php83</a> <a href="/query?status=!closed&amp;keywords=~needs-patch">needs-patch</a> <a href="/query?status=!closed&amp;keywords=~dev-feedback">dev-feedback</a>\n        </td>\n    </tr><tr>\n        <th id="h_focuses" class="missing">\n          Focuses:\n        </th>\n        <td headers="h_focuses">\n        </td>\n        <th id="h_cc" class="missing">\n          Cc:\n        </th>\n        <td headers="h_cc" class="searchable">\n        </td>\n    </tr>\n  </table>\n</div>';

const CLOSED_TICKET = '<div id="ticket" class="trac-content ">\n  <div class="date">\n    <p>Opened <a class="timeline" href="/timeline?from=2017-03-01T06%3A59%3A27Z&amp;precision=second" title="See timeline at 03/01/2017 06:59:27 AM">8 years ago</a></p>\n    <p>Closed <a class="timeline" href="/timeline?from=2017-03-08T02%3A05%3A51Z&amp;precision=second" title="See timeline at 03/08/2017 02:05:51 AM">8 years ago</a></p>\n    <p>Last modified <a class="timeline" href="/timeline?from=2019-10-16T00%3A19%3A50Z&amp;precision=second" title="See timeline at 10/16/2019 12:19:50 AM">6 years ago</a></p>\n  </div>\n  <h2>\n    <a href="/ticket/40000" class="trac-id">#40000</a>\n    <span class="trac-status">\n      <a href="/query?status=closed">closed</a>\n    </span>\n    <span class="trac-type">\n      <a href="/query?status=!closed&amp;type=enhancement">enhancement</a>\n    </span>\n    <span class="trac-resolution">\n      (<a href="/query?status=closed&amp;resolution=wontfix">wontfix</a>)\n    </span>\n  </h2>\n  <h1 id="trac-ticket-title" class="searchable">\n    <span class="summary">Alot of tickets continue to be created</span>\n  </h1>\n  <table class="properties">\n    <tr>\n      <th id="h_reporter">Reported by:</th>\n      <td headers="h_reporter" class="searchable">\n  <a href="https://profiles.wordpress.org/jorbin" data-nicename="jorbin">\n    <img class="avatar" src="https://wordpress.org/grav-redirect.php?user=jorbin&amp;s=48" srcset="https://wordpress.org/grav-redirect.php?user=jorbin&amp;s=96 2x" height="48" width="48" alt="jorbin\'s profile" />\n  </a>\n    <a class="trac-author" href="/query?status=!closed&amp;reporter=jorbin">jorbin</a>\n</td>\n      <th id="h_owner">Owned by:</th>\n      <td headers="h_owner">\n  <a href="https://profiles.wordpress.org/alot">\n    <img class="avatar" src="https://wordpress.org/grav-redirect.php?user=alot&amp;s=48" srcset="https://wordpress.org/grav-redirect.php?user=alot&amp;s=96 2x" height="48" width="48" alt="alot\'s profile" />\n  </a>\n    <a class="trac-author" href="/query?status=!closed&amp;owner=alot">alot</a>\n</td>\n    </tr>\n    <tr>\n        <th id="h_milestone">\n          Milestone:\n        </th>\n        <td headers="h_milestone">\n              <a class="closed milestone" href="/milestone/4.8" title="Completed 8 years ago (06/08/2017 03:03:46 PM)">4.8</a>\n        </td>\n        <th id="h_priority">\n          Priority:\n        </th>\n        <td headers="h_priority">\n              <a href="/query?status=!closed&amp;priority=normal">normal</a>\n        </td>\n    </tr><tr>\n        <th id="h_severity">\n          Severity:\n        </th>\n        <td headers="h_severity">\n              <a href="/query?status=!closed&amp;severity=normal">normal</a>\n        </td>\n        <th id="h_version">\n          Version:\n        </th>\n        <td headers="h_version">\n              <a href="/query?status=!closed&amp;version=0.71">0.71</a>\n        </td>\n    </tr><tr>\n        <th id="h_component">\n          Component:\n        </th>\n        <td headers="h_component">\n              <a href="/query?status=!closed&amp;component=General">General</a>\n        </td>\n        <th id="h_keywords">\n          Keywords:\n        </th>\n        <td headers="h_keywords" class="searchable">\n              <a href="/query?status=!closed&amp;keywords=~needs-more-alot">needs-more-alot</a> <a href="/query?status=!closed&amp;keywords=~has-alot">has-alot</a>\n        </td>\n    </tr><tr>\n        <th id="h_focuses">\n          Focuses:\n        </th>\n        <td headers="h_focuses">\n              <a href="/query?status=!closed&amp;focuses=~ui">ui</a>, <a href="/query?status=!closed&amp;focuses=~accessibility">accessibility</a>, <a href="/query?status=!closed&amp;focuses=~javascript">javascript</a>, <a href="/query?status=!closed&amp;focuses=~docs">docs</a>, <a href="/query?status=!closed&amp;focuses=~rtl">rtl</a>, <a href="/query?status=!closed&amp;focuses=~administration">administration</a>, <a href="/query?status=!closed&amp;focuses=~template">template</a>, <a href="/query?status=!closed&amp;focuses=~multisite">multisite</a>, <a href="/query?status=!closed&amp;focuses=~rest-api">rest-api</a>, <a href="/query?status=!closed&amp;focuses=~performance">performance</a>\n        </td>\n        <th id="h_cc" class="missing">\n          Cc:\n        </th>\n        <td headers="h_cc" class="searchable">\n        </td>\n    </tr>\n  </table>\n</div>';

test('parseTicketInfo: an open ticket yields every fact the panel shows (issue #292)', () => {
	const info = parseTicketInfo(OPEN_TICKET);

	assert.equal(info.summary, 'Introduce a `wp_json_decode()` function, including validation when available');
	assert.equal(info.status, 'new');
	assert.equal(info.type, 'enhancement');
	assert.equal(info.resolution, '');
	assert.equal(info.opened.relative, '18 months ago');
	assert.match(info.opened.absolute, /08\/28\/2023/);
	assert.equal(info.closed, null);
	assert.equal(info.milestone, 'Future Release');
	assert.equal(info.component.label, 'General');
	// The link is Trac's own query URL, made absolute — not one rebuilt here.
	assert.equal(info.component.url, 'https://core.trac.wordpress.org/query?status=!closed&component=General');
	assert.deepEqual(info.keywords.map((k) => k.label), ['php83', 'needs-patch', 'dev-feedback']);
	assert.equal(info.keywords[1].url, 'https://core.trac.wordpress.org/query?status=!closed&keywords=~needs-patch');
});

test('parseTicketInfo: a closed ticket carries its resolution and closed date (issue #292)', () => {
	const info = parseTicketInfo(CLOSED_TICKET);

	assert.equal(info.status, 'closed');
	assert.equal(info.resolution, 'wontfix');
	assert.ok(info.closed, 'the Closed line is parsed');
	assert.equal(info.closed.relative, '8 years ago');
});

test('parseTicketInfo: junk yields null, not a shell of empty fields (issue #292)', () => {
	assert.equal(parseTicketInfo(''), null);
	assert.equal(parseTicketInfo('<div>Checking your browser</div>'), null);
});

// The pill: resolution rides inside it because "closed (fixed)" and "closed
// (wontfix)" are opposite instructions to a contributor.
test('statusBadge: folds the resolution into the label and names the tone (issue #292)', () => {
	assert.deepEqual(statusBadge(parseTicketInfo(CLOSED_TICKET)), { label: 'closed (wontfix)', tone: 'closed' });
	assert.deepEqual(statusBadge(parseTicketInfo(OPEN_TICKET)), { label: 'new', tone: 'active' });
	assert.equal(statusBadge(null), null);
});
