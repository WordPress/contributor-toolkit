// What the page says about a site's two processes, the development server and
// the build watch (#557): the words on the header's two menus and on the two
// sections of the details, and whether each can be pressed.
//
// One place for both, because the header and the details show the same two
// processes and must never disagree about them.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');
const { adminUrl, adminerUrl } = require('./site-urls.cjs');
const { formatElapsed } = require('./dev-server-command.cjs');

/**
 * The development server.
 *
 * `status` is the word for the dot: `online` when the server has an address,
 * `busy` while it is starting, `offline` otherwise. `label` says the same in
 * words, for the header. `action` is what pressing does, as the name of the
 * button and of the menu's item; `short` is the word the button shows.
 *
 * While the server starts there is nothing to press: a second start would be
 * a second server (#488), and there is no stop to offer before there is a
 * server. The button says it is starting, and `pending` asks for it to be
 * drawn as busy. An update of trunk holds everything (`disabled`).
 *
 * A server that went by itself, or could not start, is `failed` until it is
 * started again, and `detail` is the sentence the details say of it: what
 * happened, and that its last lines are in the Logs. The lines are in the
 * logs' Server tab and nowhere on the page, and the logs do not come up by
 * themselves over a terminal or a mail list that is in use (tray.cjs), so
 * this sentence is what keeps the button from being one that did nothing.
 * `detail` is '' the rest of the time.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.active]     The server is running or starting.
 * @param {boolean} [root0.starting]   It is starting and has no address yet.
 * @param {boolean} [root0.isUpdating] An update of trunk is under way.
 * @param {string}  [root0.failure]    'stopped' for a server that went by itself, 'start' for one that could not start, '' otherwise.
 * @return {{status: string, label: string, action: string, short: string, pending: boolean, disabled: boolean, detail: string}}
 */
function serverProcess({ active = false, starting = false, isUpdating = false, failure = '' } = {}) {
	if (starting) {
		return { status: 'busy', label: __('Server starting…'), action: __('Starting development server…'), short: __('Starting…'), pending: true, disabled: true, detail: '' };
	}
	if (active) {
		return { status: 'online', label: __('Server running'), action: __('Stop development server'), short: __('Stop'), pending: false, disabled: isUpdating, detail: '' };
	}
	const stopped = { label: __('Server stopped'), action: __('Start development server'), short: __('Start'), pending: false, disabled: isUpdating };
	if (failure === 'stopped') {
		return { status: 'failed', ...stopped, detail: __('The development server stopped by itself. Its last lines are in the Logs.') };
	}
	if (failure === 'start') {
		return { status: 'failed', ...stopped, detail: __('The development server could not start. Its last lines are in the Logs.') };
	}
	return { status: 'offline', ...stopped, detail: '' };
}

/**
 * The build watch.
 *
 * It is `online` while it is watching, and `busy` while it builds before it
 * can watch, while it compiles a change, and while a chain has paused it and
 * will bring it back. A watch that ended without being asked to is `failed`,
 * whatever it ended with, and says what is known: the code, when it gave
 * one. So is a watch that was never started because the build before it
 * failed, and that is said as what it is, not as a watch that ended.
 *
 * It can be stopped whenever it is building or watching, and started the rest
 * of the time; paused, the button offers to start it, as it always has. An
 * update of trunk holds the button, except when the update is itself waiting
 * for the watch to be ready (#507): stopping the watch is then the one way
 * out of a watch that never gets there.
 *
 * `detail` is a sentence for the details, or '' when there is nothing to add
 * to the label.
 *
 * @param {Object}  root0
 * @param {string}  [root0.state]                'idle', 'building', 'watching', 'paused' or 'exited'.
 * @param {boolean} [root0.compiling]            Watching, and compiling a change now.
 * @param {number}  [root0.exitCode]             What an exited watch ended with.
 * @param {string}  [root0.exitOf]               'watch', or 'build' when it was the build before the watch that ended.
 * @param {boolean} [root0.isUpdating]           An update of trunk is under way.
 * @param {boolean} [root0.updateWaitingOnWatch] And it is waiting for this watch.
 * @param {string}  [root0.sourceDir]            What the watch compiles, such as `src/`.
 * @return {{status: string, label: string, action: string, short: string, disabled: boolean, detail: string}}
 */
function watchProcess({ state = 'idle', compiling = false, exitCode = null, exitOf = 'watch', isUpdating = false, updateWaitingOnWatch = false, sourceDir = '' } = {}) {
	const running = state === 'watching' || state === 'building';
	const press = running
		? { action: __('Stop build watch'), short: __('Stop') }
		: { action: __('Start build watch'), short: __('Start') };
	const disabled = isUpdating && !updateWaitingOnWatch;
	// translators: %s: a folder of the checkout, such as src/.
	const watching = sourceDir ? sprintf(__('Edits in %s are compiled as they are saved.'), sourceDir) : '';
	if (state === 'watching') {
		return compiling
			? { status: 'busy', label: __('Build compiling'), ...press, disabled, detail: watching }
			: { status: 'online', label: __('Build watching'), ...press, disabled, detail: watching };
	}
	if (state === 'building') {
		return { status: 'busy', label: __('Build building'), ...press, disabled, detail: __('Building the site before watching it.') };
	}
	if (state === 'paused') {
		return { status: 'busy', label: __('Build paused'), ...press, disabled, detail: __('Paused while another operation builds the site. It comes back by itself.') };
	}
	if (state === 'exited') {
		// The hook says 'exited' only of an end nobody asked for: a watch or
		// a build that was stopped is 'idle', and a watch that was paused is
		// 'paused'.
		const coded = Number.isFinite(exitCode);
		let detail = __('The build watch ended by itself. Its last lines are in the Logs.');
		if (exitOf === 'build' && coded) {
			// translators: %d: the exit code of a process, a number.
			detail = sprintf(__('The build that has to finish before the watch can start failed, with exit code %d, so the watch was not started. Its last lines are in the Logs.'), exitCode);
		} else if (exitOf === 'build') {
			detail = __('The build that has to finish before the watch can start failed, so the watch was not started. Its last lines are in the Logs.');
		} else if (coded && exitCode !== 0) {
			// translators: %d: the exit code of a process, a number.
			detail = sprintf(__('The build watch ended by itself, with exit code %d. Its last lines are in the Logs.'), exitCode);
		}
		return { status: 'failed', label: __('Build stopped'), ...press, disabled, detail };
	}
	return { status: 'offline', label: __('Build stopped'), ...press, disabled, detail: '' };
}

/**
 * Where a running site can be gone to: the site, its admin, and its
 * database, the last only once the server is running and not merely has an
 * address, since the database's page is the server's own.
 *
 * @param {Object}  root0
 * @param {string}  [root0.url]     The server's address, or '' while it has none.
 * @param {boolean} [root0.running] The server is running.
 * @return {Array<{id: string, label: string, href: string}>} None while there is no address.
 */
function serverLinks({ url = '', running = false } = {}) {
	if (!url) return [];
	const links = [
		{ id: 'site', label: __('View site'), href: url },
		{ id: 'admin', label: __('wp-admin'), href: adminUrl(url) }
	];
	if (running) links.push({ id: 'database', label: __('Database'), href: adminerUrl(url) });
	return links;
}

// What the app's server is set up with. Fixed, and the same on every site.
const ADMIN_CREDENTIALS = Object.freeze({ username: 'admin', password: 'password' });

/**
 * What the server's section of the details shows under its heading: where
 * the site is and what to log in with, once it has an address; how long it
 * has been starting, so that a slow start can be told from a hang (#73); or
 * nothing, which the section draws as "offline".
 *
 * `menuLinks` are the ones the header's menu has room for, the site and
 * its admin: the details can be put away, and those two should not go with
 * them. The database's page stays in the details.
 *
 * @param {Object}  root0
 * @param {string}  [root0.url]      The server's address, or '' while it has none.
 * @param {boolean} [root0.running]  The server is running.
 * @param {boolean} [root0.starting] It is starting and has no address yet.
 * @param {number}  [root0.elapsed]  Seconds since the start began.
 * @return {{state: string, links: Array, menuLinks: Array, credentials: (Object|null), text: string}}
 */
function serverSection({ url = '', running = false, starting = false, elapsed = 0 } = {}) {
	if (url) {
		const links = serverLinks({ url, running });
		return { state: 'online', links, menuLinks: links.filter((link) => link.id !== 'database'), credentials: ADMIN_CREDENTIALS, text: '' };
	}
	if (starting) {
		// translators: %s: how long, such as "12s" or "1m 05s".
		return { state: 'starting', links: [], menuLinks: [], credentials: null, text: sprintf(__('Dev server is starting… (%s)'), formatElapsed(elapsed)) };
	}
	return { state: 'offline', links: [], menuLinks: [], credentials: null, text: '' };
}

module.exports = { serverProcess, watchProcess, serverLinks, serverSection, ADMIN_CREDENTIALS };
