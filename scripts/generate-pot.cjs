// Extracts every translatable string in src/ into a gettext template (.pot).
//
// `npm run i18n:pot` writes contributor-toolkit.pot at the repository root, the
// file a translator (or translate.wordpress.org) starts from. It is generated,
// never committed to trunk, so it cannot drift from the source;
// .github/workflows/i18n-pot.yml publishes it to the `translations` branch for
// translate.wordpress.org.
//
// The extraction is @wordpress/babel-plugin-makepot, the one WordPress itself
// uses. That plugin skips a translation call whose string is not a literal
// (`__(message)`) without a word, which would leave the string out of every
// translation for good, so this script looks for those too and refuses them.

const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const makepot = require('@wordpress/babel-plugin-makepot');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'contributor-toolkit.pot');
const PROJECT = 'WordPress Contributor Toolkit';
const { bugs, license } = require('../package.json');

// The header entries Openverse's .pot carries, the ones a gettext tool or
// translate.wordpress.org expects to find. Replacing the plugin's defaults
// drops its `X-Generator`, and Content-Type must name its charset here or the
// compiler writes `text/plain;` with none.
function potHeaders(now = new Date()) {
	return {
		'project-id-version': PROJECT,
		'report-msgid-bugs-to': bugs.url,
		'pot-creation-date': `${now.toISOString().split('.')[0]}+00:00`,
		'mime-version': '1.0',
		'content-type': 'text/plain; charset=UTF-8',
		'content-transfer-encoding': '8bit',
		'po-revision-date': 'YEAR-MO-DA HO:MI+ZONE',
		'last-translator': 'FULL NAME <EMAIL@ADDRESS>',
		'language-team': 'LANGUAGE <LL@li.org>'
	};
}

// The argument each translation function reads its source string from: the
// singular for all four, and the plural too for `_n` and `_nx`.
const STRING_ARGUMENTS = { __: [0], _x: [0], _n: [0, 1], _nx: [0, 1] };

// The esbuild bundle is generated from index.jsx and repeats every string in
// it, alongside every dependency's.
const SKIP = new Set([path.join(REPO_ROOT, 'src', 'renderer', 'index.js')]);

function sourceFiles(dir = path.join(REPO_ROOT, 'src')) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.(c?js|jsx)$/.test(entry.name) && !SKIP.has(full) ? [full] : [];
	});
}

// Reports each translation call whose string argument is not a literal.
function nonLiteralCalls(problems) {
	return {
		visitor: {
			CallExpression({ node }, state) {
				const name = node.callee.type === 'MemberExpression' ? node.callee.property.name : node.callee.name;
				if (!Object.hasOwn(STRING_ARGUMENTS, name)) return;
				for (const i of STRING_ARGUMENTS[name]) {
					const arg = node.arguments[i];
					if (!arg || arg.type === 'StringLiteral') continue;
					const file = path.relative(REPO_ROOT, state.filename);
					problems.push(`${file}:${node.loc.start.line} ${name}() needs a string literal, not ${arg.type}`);
				}
			}
		}
	};
}

/**
 * Writes the .pot for `files` to `output`.
 *
 * @param {Object}   [options]
 * @param {string[]} [options.files]  Source files to scan; every .js/.cjs/.jsx under src/ by default.
 * @param {string}   [options.output] Where to write the .pot.
 * @return {{output: string, problems: string[]}} Where the .pot went, and each non-literal call found.
 */
function generatePot({ files = sourceFiles(), output = DEFAULT_OUTPUT } = {}) {
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.rmSync(output, { force: true });
	const problems = [];
	const now = new Date();
	// One plugin list for every file, so Babel reuses one instance of the
	// makepot plugin and its strings accumulate across files.
	const plugins = [
		[makepot, { output, headers: potHeaders(now) }],
		nonLiteralCalls(problems)
	];
	// The plugin writes each `#:` reference relative to the process's working
	// directory, not Babel's `cwd`, so the .pot reads the same wherever this is
	// run from only if the working directory is the repository while it runs.
	const previousCwd = process.cwd();
	process.chdir(REPO_ROOT);
	try {
		for (const file of files) {
			babel.transformSync(fs.readFileSync(file, 'utf8'), {
				filename: file,
				babelrc: false,
				configFile: false,
				code: false,
				parserOpts: { plugins: ['jsx'] },
				plugins
			});
		}
	} finally {
		process.chdir(previousCwd);
	}
	// The plugin has no option for the comment above the header entry.
	if (fs.existsSync(output)) {
		const comment = `# Copyright (C) ${now.getUTCFullYear()} ${PROJECT}\n# This file is distributed under the ${license} license.\n`;
		fs.writeFileSync(output, comment + fs.readFileSync(output, 'utf8'));
	}
	return { output, problems };
}

module.exports = { generatePot, sourceFiles };

if (require.main === module) {
	const { output, problems } = generatePot();
	if (problems.length) {
		console.error(`Translation calls the .pot cannot hold:\n${problems.map((p) => `  ${p}`).join('\n')}`);
		process.exit(1);
	}
	console.log(`Wrote ${path.relative(REPO_ROOT, output)}`);
}
