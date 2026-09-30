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
	// References are relative to the repository, so the .pot reads the same on
	// every machine that generates it.
	assert.match(pot, /#: src\/renderer\/index\.jsx:\d+/);
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
