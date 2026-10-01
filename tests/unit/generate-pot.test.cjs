'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generatePot } = require('../../scripts/generate-pot.cjs');

function tempDir(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-pot-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test('the .pot holds the first-run screen and has no call it cannot extract', (t) => {
	// Run from somewhere other than the repository, to prove the references
	// do not depend on where the script was started.
	const previousCwd = process.cwd();
	process.chdir(os.tmpdir());
	t.after(() => process.chdir(previousCwd));
	const { output, problems } = generatePot({ output: path.join(tempDir(t), 'toolkit.pot') });
	assert.deepEqual(problems, []);
	const pot = fs.readFileSync(output, 'utf8');
	for (const msgid of ['No sites yet.', 'Create a site', 'Use the sidebar to create your first site.']) {
		assert.ok(pot.includes(`msgid "${msgid}"`), `${msgid} is in the .pot`);
	}
	// The header names the encoding, so the non-ASCII strings import intact.
	assert.match(pot, /"Content-Type: text\/plain; charset=utf-8\\n"/i);
	// The string a right-to-left locale translates to `rtl`, with its context, so
	// translators for Arabic, Hebrew and Persian can set it.
	assert.match(pot, /msgctxt "text direction"\nmsgid "ltr"/);
	// References are relative to the repository, so the .pot reads the same on
	// every machine that generates it.
	assert.match(pot, /#: src\/renderer\/index\.jsx:\d+/);
});

test('the .pot carries the full gettext header', (t) => {
	const { output } = generatePot({ output: path.join(tempDir(t), 'toolkit.pot') });
	// Join the lines the compiler wraps at 76 columns back into one string each.
	const pot = fs.readFileSync(output, 'utf8').replace(/"\n"/g, '');
	assert.match(pot, /^# Copyright \(C\) \d{4} WordPress Contributor Toolkit\n# This file is distributed under the GPL-2\.0-or-later license\.\n/);
	for (const header of [
		'Project-Id-Version: WordPress Contributor Toolkit',
		'Report-Msgid-Bugs-To: https://github.com/WordPress/contributor-toolkit/issues',
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=utf-8',
		'Content-Transfer-Encoding: 8bit',
		'PO-Revision-Date: YEAR-MO-DA HO:MI+ZONE',
		'Last-Translator: FULL NAME <EMAIL@ADDRESS>',
		'Language-Team: LANGUAGE <LL@li.org>'
	]) {
		assert.ok(pot.includes(`${header}\\n`), `${header} is in the header`);
	}
	assert.match(pot, /POT-Creation-Date: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00\\n/);
});

test('a translation call with a non-literal string is refused, with its line', (t) => {
	const dir = tempDir(t);
	const file = path.join(dir, 'copy.cjs');
	fs.writeFileSync(file, [
		"const { __, _n, sprintf } = require('@wordpress/i18n');",
		"const message = 'Hello';",
		'__(message);',
		"__(`Hi ${message}`);",
		"_n('One site', `${1} sites`, 2);",
		'__(`Static`);',
		"__('Fine');",
		"sprintf(__('Fine %s'), message);",
		''
	].join('\n'));

	const { problems } = generatePot({ files: [file], output: path.join(dir, 'out.pot') });

	assert.equal(problems.length, 4, problems.join('\n'));
	assert.match(problems[0], /copy\.cjs:3 __\(\) needs a string literal, not Identifier/);
	assert.match(problems[1], /copy\.cjs:4 __\(\) needs a string literal, not TemplateLiteral/);
	assert.match(problems[2], /copy\.cjs:5 _n\(\) needs a string literal, not TemplateLiteral/);
	// The extractor reads only string literals, so even a template with nothing in it would be left out of the POT.
	assert.match(problems[3], /copy\.cjs:6 __\(\) needs a string literal, not TemplateLiteral/);
});

// Every string shape the source can hand the extractor that has to be escaped,
// split or grouped in the .pot: a mistake in any of them is a syntax error when
// translate.wordpress.org imports the file, or a string imported wrong.
const TRICKY_SOURCE = [
	"import { __, _n, _x, _nx, sprintf } from '@wordpress/i18n';",
	"__('Say \"hello\"');",
	"__(\"It's a site\");",
	"__('C:\\\\Users\\\\Contributor');",
	"__('Line one\\nLine two');",
	"__('Tab\\there');",
	"__('Café — naïve “curly” 日本語');",
	'// translators: %s: the site name.',
	"sprintf(__('Delete %s?'), name);",
	'// translators: 1: the number of sites, 2: the folder.',
	"sprintf(_n('%1$d site in %2$s', '%1$d sites in %2$s', n), n, dir);",
	"_nx('One \"patch\"', '%d \"patches\"', n, 'ticket attachments');",
	"_x('Post', 'verb');",
	"_x('Post', 'noun');",
	"__('Say \"hello\"');",
	"__('A very long string that goes well past the seventy-six columns gettext wraps at, so the compiler has to split it across lines.');",
	"<p>{__('100% done')}</p>;",
	''
].join('\n');

function trickyPot(t) {
	const dir = tempDir(t);
	const file = path.join(dir, 'copy.jsx');
	fs.writeFileSync(file, TRICKY_SOURCE);
	const { output, problems } = generatePot({ files: [file], output: path.join(dir, 'tricky.pot') });
	assert.deepEqual(problems, []);
	return output;
}

// The entries of a .pot, each without its `#:` reference lines, which name a
// temporary directory here.
function entries(pot) {
	return pot.split(/\n\n/).map((entry) => entry.split('\n').filter((line) => !line.startsWith('#:')).join('\n').trim());
}

test('quotes, backslashes, newlines and tabs are escaped the way gettext reads them', (t) => {
	const pot = entries(fs.readFileSync(trickyPot(t), 'utf8'));
	for (const expected of [
		'msgid "Say \\"hello\\""\nmsgstr ""',
		'msgid "It\'s a site"\nmsgstr ""',
		'msgid "C:\\\\Users\\\\Contributor"\nmsgstr ""',
		'msgid ""\n"Line one\\n"\n"Line two"\nmsgstr ""',
		'msgid "Tab\\there"\nmsgstr ""',
		'msgid "Café — naïve “curly” 日本語"\nmsgstr ""',
		'msgid "100% done"\nmsgstr ""',
		// Wrapped at 76 columns into continuation lines, not cut or left over-long.
		'msgid ""\n"A very long string that goes well past the seventy-six columns gettext "\n"wraps at, so the compiler has to split it across lines."\nmsgstr ""'
	]) {
		assert.ok(pot.includes(expected), `the .pot has the entry\n${expected}`);
	}
	// The string used twice is one entry, or gettext refuses the file as a duplicate.
	assert.equal(pot.filter((entry) => entry.includes('msgid "Say \\"hello\\""')).length, 1);
});

test('plurals, context and translator comments keep the shape gettext expects', (t) => {
	const pot = entries(fs.readFileSync(trickyPot(t), 'utf8'));
	for (const expected of [
		'#. 1: the number of sites, 2: the folder.\nmsgid "%1$d site in %2$s"\nmsgid_plural "%1$d sites in %2$s"\nmsgstr[0] ""\nmsgstr[1] ""',
		'msgctxt "ticket attachments"\nmsgid "One \\"patch\\""\nmsgid_plural "%d \\"patches\\""\nmsgstr[0] ""\nmsgstr[1] ""',
		'#. %s: the site name.\nmsgid "Delete %s?"\nmsgstr ""',
		// The same English word with two meanings stays two entries.
		'msgctxt "verb"\nmsgid "Post"\nmsgstr ""',
		'msgctxt "noun"\nmsgid "Post"\nmsgstr ""'
	]) {
		assert.ok(pot.includes(expected), `the .pot has the entry\n${expected}`);
	}
});

// msgfmt is GNU gettext's own compiler, and the strictest reader of a .pot
// there is. It is not a dependency of this project, so the check runs only where
// it is installed.
const msgfmt = spawnSync('msgfmt', ['--version']).status === 0;

test('msgfmt accepts the .pot of the tricky strings and of src/', { skip: !msgfmt && 'msgfmt is not installed' }, (t) => {
	const { output } = generatePot({ output: path.join(tempDir(t), 'toolkit.pot') });
	for (const pot of [trickyPot(t), output]) {
		const result = spawnSync('msgfmt', ['--check', '-o', os.devNull, pot], { encoding: 'utf8' });
		// A template leaves the translator's header fields at their defaults, and
		// msgfmt warns about those; anything else it says is a problem.
		const complaints = result.stderr.split('\n').filter((line) => line && !/header field '[\w-]+' (still has the initial default value|missing in header)/.test(line));
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(complaints, [], `msgfmt complained about ${pot}`);
	}
});
