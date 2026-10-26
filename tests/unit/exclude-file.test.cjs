const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { appendExcludeBlock } = require('../../src/exclude-file.cjs');
const { tempDir } = require('./helpers/git.cjs');

const MARKER = '# WordPress Contributor Toolkit test block';

function excludePath(dir) {
	return path.join(dir, '.git', 'info', 'exclude');
}

function readExclude(dir) {
	return fs.readFileSync(excludePath(dir), 'utf8');
}

function writeExclude(dir, text) {
	fs.mkdirSync(path.dirname(excludePath(dir)), { recursive: true });
	fs.writeFileSync(excludePath(dir), text);
}

test('a missing info directory and exclude file are created, marker first (#523)', async (t) => {
	const dir = tempDir(t, 'exclude-file-');
	fs.mkdirSync(path.join(dir, '.git'));

	assert.equal(await appendExcludeBlock(dir, MARKER, ['/a/', '/b']), true);
	assert.equal(readExclude(dir), `${MARKER}\n/a/\n/b\n`);
});

test('the contributor\'s own rules are kept, and a last line without a newline is not joined (#523)', async (t) => {
	const dir = tempDir(t, 'exclude-file-');
	writeExclude(dir, '# mine\nmine/');

	await appendExcludeBlock(dir, MARKER, ['/a/']);
	assert.equal(readExclude(dir), `# mine\nmine/\n${MARKER}\n/a/\n`);
});

test('only the lines not already there are appended, under one marker (#521, #523)', async (t) => {
	const dir = tempDir(t, 'exclude-file-');
	writeExclude(dir, `${MARKER}\r\n/a/\r\n`);

	assert.equal(await appendExcludeBlock(dir, MARKER, ['/a/', '/b']), true);
	assert.equal(readExclude(dir), `${MARKER}\r\n/a/\r\n/b\n`);
	assert.equal(await appendExcludeBlock(dir, MARKER, ['/a/', '/b']), false, 'nothing left to write');
	assert.equal(readExclude(dir), `${MARKER}\r\n/a/\r\n/b\n`);
});

test('once: a block whose marker is there is the contributor\'s, and a rule they removed is not restored (#19, #523)', async (t) => {
	const dir = tempDir(t, 'exclude-file-');
	writeExclude(dir, `${MARKER}\n/a/\n`);

	assert.equal(await appendExcludeBlock(dir, MARKER, ['/a/', '/b'], { once: true }), false);
	assert.equal(readExclude(dir), `${MARKER}\n/a/\n`);
});

test('once: a block whose marker is missing is written whole (#19, #523)', async (t) => {
	const dir = tempDir(t, 'exclude-file-');
	writeExclude(dir, '/a/\n');

	assert.equal(await appendExcludeBlock(dir, MARKER, ['/a/', '/b'], { once: true }), true);
	assert.equal(readExclude(dir), `/a/\n${MARKER}\n/a/\n/b\n`);
});
