'use strict';

// The dispatcher that lets the app ask "which work item is this site on?"
// without knowing whether the answer is a Trac ticket or a GitHub issue (#251).
// What matters here is that it picks the right one and defaults to Trac, since
// every site created before project types existed has no provider recorded.

const test = require('node:test');
const assert = require('node:assert');
const { workItemProvider } = require('../src/work-item.cjs');
const { getProjectType } = require('../src/project-type.cjs');

test('the Trac provider is the default for anything unknown or missing', () => {
	for (const provider of [undefined, null, '', 'nonsense', 'TRAC']) {
		const wi = workItemProvider(provider);
		assert.strictEqual(wi.kind, 'trac', `expected trac for ${JSON.stringify(provider)}`);
		assert.strictEqual(wi.noun, 'ticket');
	}
});

test('the Trac provider parses tickets and knows how to attach to one', () => {
	const wi = workItemProvider('trac');

	assert.deepStrictEqual(wi.parseRef('62281'), {
		ok: true, id: 62281, url: 'https://core.trac.wordpress.org/ticket/62281'
	});
	assert.strictEqual(wi.urlFor(62281), 'https://core.trac.wordpress.org/ticket/62281');
	assert.match(wi.attachUrlFor(62281), /attachment\/ticket\/62281\/\?action=new$/);
});

test('the GitHub provider parses issues against the site’s own repository', () => {
	const wi = workItemProvider('github-issue', 'WordPress/gutenberg');

	assert.strictEqual(wi.kind, 'github-issue');
	assert.strictEqual(wi.noun, 'issue');
	assert.deepStrictEqual(wi.parseRef('#71234'), {
		ok: true, id: 71234, url: 'https://github.com/WordPress/gutenberg/issues/71234'
	});
	assert.strictEqual(wi.urlFor(71234), 'https://github.com/WordPress/gutenberg/issues/71234');
	// A Trac URL is not a GitHub issue, and must not quietly parse as one.
	assert.strictEqual(wi.parseRef('https://core.trac.wordpress.org/ticket/62281').ok, false);
});

// Null rather than a no-op: a caller has to decide what to show instead of
// rendering an "attach a patch" affordance that leads nowhere. GitHub issues
// carry no patch attachments — that work arrives as a pull request.
test('the GitHub provider has no attachment destination', () => {
	assert.strictEqual(workItemProvider('github-issue', 'WordPress/gutenberg').attachUrlFor, null);
});

// The tie-back: the provider a site gets is the one its project type names.
test('each project type selects its own provider', () => {
	assert.strictEqual(workItemProvider(getProjectType('core').workItem.provider).kind, 'trac');
	assert.strictEqual(
		workItemProvider(getProjectType('gutenberg').workItem.provider, 'WordPress/gutenberg').kind,
		'github-issue'
	);
});
