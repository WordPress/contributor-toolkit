'use strict';

/**
 * The pseudo-locale: every translated string accented, padded and bracketed,
 * so a string that reaches the screen without going through `__()` stands out.
 *
 * Pure and dependency-free: the renderer bundle imports it, `node --test`
 * requires it directly.
 */

// Chromium's own name for its accented pseudo-locale, so `--lang=en-XA` is the
// same switch a Chromium developer would already reach for.
const PSEUDO_LOCALE = 'en-XA';

/**
 * Whether a locale is the pseudo-locale rather than a language.
 *
 * @param {string} locale
 * @return {boolean}
 */
function isPseudoLocale(locale) {
	return locale === PSEUDO_LOCALE;
}

const ACCENTED = {
	a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
	n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
	A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
	N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž'
};

// What must survive untouched: sprintf placeholders (`%s`, `%1$d`, `%%`) and
// markup (`<a>`, `</strong>`), since both are read by code, not by people.
const PROTECTED = /%(?:\d+\$)?[-+ 0#]*\d*(?:\.\d+)?[bcdeEfFgGosuxX%]|<[^>]*>/g;

/**
 * A string as the pseudo-locale shows it: letters accented, about a third
 * longer, and bracketed.
 *
 * The brackets are what the journey looks for, so a string that reaches the
 * screen without them never went through a translation call. The padding
 * stands in for languages that run longer than English.
 *
 * @param {string} text
 * @return {string}
 */
function pseudoLocalize(text) {
	if (typeof text !== 'string' || text === '') return text;
	let out = '';
	let last = 0;
	for (const match of text.matchAll(PROTECTED)) {
		out += accent(text.slice(last, match.index)) + match[0];
		last = match.index + match[0].length;
	}
	out += accent(text.slice(last));
	return `[${out}${'~'.repeat(Math.ceil(text.length * 0.3))}]`;
}

function accent(text) {
	return text.replace(/[A-Za-z]/g, (ch) => ACCENTED[ch]);
}

module.exports = { isPseudoLocale, pseudoLocalize, PSEUDO_LOCALE };
