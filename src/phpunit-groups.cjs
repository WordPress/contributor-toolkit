'use strict';

const fs = require('fs');
const path = require('path');

// The named groups core's PHP unit tests are tagged with, read from the
// checkout itself, for the Tests section's Group field to suggest. Read from
// the files rather than asked of PHPUnit (`--list-groups`), which would boot
// the whole test setup first: this is a read of plain text, and it follows
// whatever branch is checked out.
//
// Ticket numbers are groups too (PHPUnit counts `@ticket` as one), but there
// are thousands of them, so they are left to the placeholder and the hint.

// Where core keeps its test classes.
const TESTS_REL = path.join('tests', 'phpunit', 'tests');

// The names after `@group` in one file's source. A name that is only digits is
// a ticket written as a group, and is left out with the rest of them.
function groupsInSource(source) {
	const names = [];
	for (const match of String(source).matchAll(/@group\s+([^\s*]+)/g)) {
		if (!/^\d+$/.test(match[1])) names.push(match[1]);
	}
	return names;
}

// Every named group in the checkout's tests, sorted, each once. A checkout
// with no tests folder has none.
async function listTestGroups(sitePath) {
	const root = path.join(sitePath, TESTS_REL);
	let entries;
	try {
		entries = await fs.promises.readdir(root, { recursive: true });
	} catch (err) {
		if (err.code === 'ENOENT') return [];
		throw err;
	}
	const groups = new Set();
	for (const entry of entries) {
		if (!entry.endsWith('.php')) continue;
		const source = await fs.promises.readFile(path.join(root, entry), 'utf8');
		for (const name of groupsInSource(source)) groups.add(name);
	}
	return [...groups].sort();
}

module.exports = { groupsInSource, listTestGroups };
