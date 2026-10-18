// Where a site's context menu should anchor: the exact point of a real
// pointer event, or the pressed row's centre when the request came from the
// keyboard and carries no point of its own.
//
// `clientX`/`clientY` of `0` is a real point — the viewport's corner — not a
// missing one, so a keyboard request has to be told apart by the event's
// `type` rather than by testing the coordinates themselves: `event.clientX ||
// fallback` would have sent a right-click at the literal edge of the screen
// to the row's centre instead.
//
// Pure for the same reason as site-folder.cjs: `index.jsx` cannot be loaded
// without a DOM, so this is split out to where `node --test` can reach it.
'use strict';

/**
 * @param {Object} event
 * @param {string} event.type    `'contextmenu'` for a real pointer event,
 *                               anything else (a keydown) for the keyboard.
 * @param {number} event.clientX
 * @param {number} event.clientY
 * @param {Object} bounds        The pressed row's `getBoundingClientRect()`.
 * @return {{x: number, y: number}}
 */
function resolveContextMenuPosition({ type, clientX, clientY }, bounds) {
	if (type === 'contextmenu') return { x: clientX, y: clientY };
	return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

module.exports = { resolveContextMenuPosition };
