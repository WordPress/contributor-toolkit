'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
