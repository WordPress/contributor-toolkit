const test = require('node:test');
const assert = require('node:assert/strict');

const { terminalTheme, terminalFont, tokenName, TERMINAL_COLOR_TOKENS, TERMINAL_FONT_FALLBACK, TERMINAL_READABILITY } = require('../../src/renderer/terminal-theme.cjs');

// A reader that finds every token, and one that says what it was asked.
const everything = { value: () => 'there', color: (token) => `read(${token})` };

test('every colour of the terminal is a token of the design system, and none is written out', () => {
	for (const [name, token] of Object.entries(TERMINAL_COLOR_TOKENS)) {
		assert.match(token, /^var\(--wpds-color-[a-z-]+\)$/, name);
	}
});

test('the terminal is the log panes\' surface, with the text\'s own colour on it', () => {
	assert.equal(TERMINAL_COLOR_TOKENS.background, 'var(--wpds-color-background-surface-neutral-weak)');
	assert.equal(TERMINAL_COLOR_TOKENS.foreground, 'var(--wpds-color-foreground-content-neutral)');
	// The cursor is a block of the text's colour, and the letter under it the
	// surface's.
	assert.equal(TERMINAL_COLOR_TOKENS.cursor, TERMINAL_COLOR_TOKENS.foreground);
	assert.equal(TERMINAL_COLOR_TOKENS.cursorAccent, TERMINAL_COLOR_TOKENS.background);
});

test('a command\'s red, green and yellow are what an error, a success and a warning are said in', () => {
	assert.match(TERMINAL_COLOR_TOKENS.red, /content-error-weak/);
	assert.match(TERMINAL_COLOR_TOKENS.green, /content-success-weak/);
	assert.match(TERMINAL_COLOR_TOKENS.yellow, /content-warning-weak/);
});

test('a command\'s white and black are the text\'s colours and not the surface\'s', () => {
	for (const name of ['black', 'white', 'brightBlack', 'brightWhite']) {
		assert.match(TERMINAL_COLOR_TOKENS[name], /^var\(--wpds-color-foreground-content-neutral/, name);
		assert.notEqual(TERMINAL_COLOR_TOKENS[name], TERMINAL_COLOR_TOKENS.background, name);
	}
});

test('a bright colour is the plain one: the design system\'s stronger colours are all but black on this surface', () => {
	for (const name of ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan']) {
		const bright = `bright${name[0].toUpperCase()}${name.slice(1)}`;
		assert.equal(TERMINAL_COLOR_TOKENS[bright], TERMINAL_COLOR_TOKENS[name], bright);
	}
	// None of them is one of the strong colours, which have no "-weak" and
	// are for text on a tinted notice.
	for (const name of ['red', 'green', 'yellow', 'blue', 'cyan']) {
		assert.match(TERMINAL_COLOR_TOKENS[name], /-weak\)$/, name);
	}
});

test('the selection is given a strong colour, since the terminal paints it at a third of its strength', () => {
	assert.equal(TERMINAL_COLOR_TOKENS.selectionBackground, 'var(--wpds-color-background-interactive-brand-strong)');
	assert.notEqual(TERMINAL_COLOR_TOKENS.selectionBackground, TERMINAL_COLOR_TOKENS.background);
});

test('a colour too close to what is behind it is moved until it can be read', () => {
	assert.deepEqual(TERMINAL_READABILITY, { minimumContrastRatio: 4.5 });
});

test('all sixteen numbered colours are given, with the surface, the text, the cursor and the selection', () => {
	const numbered = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
	const names = Object.keys(TERMINAL_COLOR_TOKENS);
	for (const name of numbered) {
		assert.ok(names.includes(name), name);
		const bright = `bright${name[0].toUpperCase()}${name.slice(1)}`;
		assert.ok(names.includes(bright), bright);
	}
	for (const name of ['background', 'foreground', 'cursor', 'cursorAccent', 'selectionBackground']) assert.ok(names.includes(name), name);
	assert.equal(names.length, 21);
});

test('the theme is each token\'s colour as it was read', () => {
	const theme = terminalTheme(everything);
	assert.equal(theme.background, 'read(var(--wpds-color-background-surface-neutral-weak))');
	assert.equal(theme.red, `read(${TERMINAL_COLOR_TOKENS.red})`);
	assert.deepEqual(Object.keys(theme).sort(), Object.keys(TERMINAL_COLOR_TOKENS).sort());
});

test('a token that is not there is left to the terminal, and its colour is not asked for', () => {
	const asked = [];
	const theme = terminalTheme({
		value: (token) => (token === TERMINAL_COLOR_TOKENS.red ? '' : '#123456'),
		color: (token) => { asked.push(token); return '#123456'; }
	});
	assert.equal('red' in theme, false);
	assert.equal('brightRed' in theme, false);
	assert.equal(theme.green, '#123456');
	assert.equal(asked.includes(TERMINAL_COLOR_TOKENS.red), false);
	// A value of nothing but spaces is no value.
	assert.deepEqual(terminalTheme({ value: () => '   ', color: () => '#123456' }), {});
	assert.deepEqual(terminalTheme({ value: () => undefined, color: () => '#123456' }), {});
});

test('a colour that could not be read is left to the terminal, not given as nothing', () => {
	const theme = terminalTheme({ value: () => 'there', color: (token) => (token === TERMINAL_COLOR_TOKENS.green ? '' : '#123456') });
	assert.equal('green' in theme, false);
	assert.equal(theme.red, '#123456');
});

test('the font is the tokens\' monospace family and medium size, as numbers and names the terminal takes', () => {
	const values = {
		'var(--wpds-typography-font-family-mono)': '"Menlo",\n    "Consolas",\n    monaco,\n    monospace',
		'var(--wpds-typography-font-size-md)': '13px'
	};
	assert.deepEqual(terminalFont((token) => values[token]), { fontFamily: '"Menlo", "Consolas", monaco, monospace', fontSize: 13 });
});

test('a font that could not be read falls back to a monospace one at thirteen pixels', () => {
	assert.deepEqual(terminalFont(() => ''), TERMINAL_FONT_FALLBACK);
	assert.deepEqual(terminalFont(() => undefined), TERMINAL_FONT_FALLBACK);
	assert.equal(terminalFont((token) => (token.includes('size') ? 'large' : 'Menlo')).fontSize, 13);
	assert.equal(terminalFont((token) => (token.includes('size') ? '0px' : 'Menlo')).fontSize, 13);
});

test('a token is named by what is inside its var(), and nothing else is a token', () => {
	assert.equal(tokenName('var(--some-colour)'), '--some-colour');
	assert.equal(tokenName('var( --some-size-md )'), '--some-size-md');
	assert.equal(tokenName('--some-size-md'), '');
	assert.equal(tokenName('var(--a, #fff)'), '');
	assert.equal(tokenName(undefined), '');
	// Every token of the theme is written so that it has one.
	for (const token of Object.values(TERMINAL_COLOR_TOKENS)) assert.notEqual(tokenName(token), '', token);
});
