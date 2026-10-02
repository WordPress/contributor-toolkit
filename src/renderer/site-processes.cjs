// What the page says about a site's two processes, the development server and
// the build watch (#557): the words on the header's two menus and on the two
// sections of the details, and whether each can be pressed.
//
// One place for both, because the header and the details show the same two
// processes and must never disagree about them.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

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
 * @param {Object}  root0
 * @param {boolean} [root0.active]     The server is running or starting.
 * @param {boolean} [root0.starting]   It is starting and has no address yet.
 * @param {boolean} [root0.isUpdating] An update of trunk is under way.
 * @return {{status: string, label: string, action: string, short: string, pending: boolean, disabled: boolean}}
 */
function serverProcess({ active = false, starting = false, isUpdating = false } = {}) {
	if (starting) {
		return { status: 'busy', label: __('Server starting…'), action: __('Starting development server…'), short: __('Starting…'), pending: true, disabled: true };
	}
	if (active) {
		return { status: 'online', label: __('Server running'), action: __('Stop development server'), short: __('Stop'), pending: false, disabled: isUpdating };
	}
	return { status: 'offline', label: __('Server stopped'), action: __('Start development server'), short: __('Start'), pending: false, disabled: isUpdating };
}

/**
 * The build watch.
 *
 * It is `online` while it is watching, and `busy` while it builds before it
 * can watch, while it compiles a change, and while a chain has paused it and
 * will bring it back. A watch that ended by itself with an error is `failed`,
 * and says with what.
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
 * @param {boolean} [root0.isUpdating]           An update of trunk is under way.
 * @param {boolean} [root0.updateWaitingOnWatch] And it is waiting for this watch.
 * @param {string}  [root0.sourceDir]            What the watch compiles, such as `src/`.
 * @return {{status: string, label: string, action: string, short: string, disabled: boolean, detail: string}}
 */
function watchProcess({ state = 'idle', compiling = false, exitCode = null, isUpdating = false, updateWaitingOnWatch = false, sourceDir = '' } = {}) {
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
	if (state === 'exited' && Number.isFinite(exitCode) && exitCode !== 0) {
		// translators: %d: the exit code of a process, a number.
		return { status: 'failed', label: __('Build stopped'), ...press, disabled, detail: sprintf(__('The build watch ended by itself, with exit code %d. Its last lines are in the Logs.'), exitCode) };
	}
	return { status: 'offline', label: __('Build stopped'), ...press, disabled, detail: '' };
}

module.exports = { serverProcess, watchProcess };
