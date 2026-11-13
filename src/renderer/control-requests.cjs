'use strict';

/**
 * What the window does with a request a tool sent through the `toolkit`
 * command (#764): which site's row it is for, whether the row can do it now,
 * what to press, and how to tell when what was pressed has ended.
 *
 * A request is carried out by the same function a button calls, so the
 * terminal's lock, the build watch and every refusal the page already has
 * apply unchanged. What is added here is what a press does not have: an
 * answer. A person reads the page to see how a start ended; a tool is told,
 * by reading the same state the page is drawn from.
 *
 * Pure, like the other `src/renderer/*.cjs` modules, so the suite covers it
 * without a DOM. The sentences are English and not translated: they are read
 * by the tool that asked, as the command's own are.
 */

const ok = (result) => ({ ok: true, result });
const refusal = (code, error) => ({ ok: false, code, error });

// The longest a row waits for what it pressed to end: a first start can sit
// behind a full build.
const OUTCOME_TIMEOUT_MS = 30 * 60 * 1000;

// How long a site's row gets to be mounted, and then to have read its status,
// before a request for it is turned away.
const ROW_WAIT_MS = 20000;
const LOADING_WAIT_MS = 30000;

// How long a press gets to show on the page that it began. A press the page
// turned away, because a command took the terminal a moment before, says so
// in the terminal and changes nothing an answer could be read from; without
// this the request would wait out the whole of OUTCOME_TIMEOUT_MS.
const START_GRACE_MS = 20000;

/**
 * What a row is in the middle of, from the flags its page is drawn from.
 * `loading` is a status not yet read, which is waited for; `held` is what
 * nothing may start under; `busy` is work that ends by itself.
 *
 * @param {Object}  flags
 * @param {boolean} flags.statusLoading
 * @param {boolean} flags.isPending
 * @param {boolean} flags.isDeleting
 * @param {boolean} flags.isUpdating
 * @param {string}  flags.setupChainState
 * @param {boolean} flags.terminalRunning
 * @param {boolean} flags.isApplying
 * @param {boolean} flags.installing
 * @param {boolean} flags.building
 * @param {boolean} flags.ticketSaving
 * @return {{loading: boolean, held: boolean, busy: boolean}}
 */
function rowActivity({ statusLoading, isPending, isDeleting, isUpdating, setupChainState, terminalRunning, isApplying, installing, building, ticketSaving }) {
	return {
		loading: Boolean(statusLoading),
		held: Boolean(isPending || isDeleting || isUpdating || (setupChainState && setupChainState !== 'idle')),
		busy: Boolean(terminalRunning || isApplying || isUpdating || installing || building || ticketSaving)
	};
}

/**
 * The rows that can be asked, by the site each is for.
 *
 * @param {Object}   [root0]
 * @param {Function} [root0.setTimer]
 * @param {Function} [root0.clearTimer]
 * @param {number}   [root0.rowWaitMs]
 * @return {{register: (sitePath: string, perform: Function) => Function, handle: (request: Object) => Promise<Object>}}
 */
function createControlRegistry({ setTimer = setTimeout, clearTimer = clearTimeout, rowWaitMs = ROW_WAIT_MS } = {}) {
	const rows = new Map();
	const awaited = new Map();
	let app = null;
	// The page says it is listening as soon as it mounts, which is before it
	// has read its sites and mounted a row for each: a request that opened
	// the app, or its window, arrives in that gap. So a site with no row yet
	// is waited for, briefly, before it is called not open.
	const rowFor = (sitePath) => {
		if (rows.has(sitePath)) return Promise.resolve(rows.get(sitePath));
		return new Promise((resolve) => {
			const waiter = (perform) => {
				clearTimer(timer);
				awaited.get(sitePath)?.delete(waiter);
				resolve(perform);
			};
			const timer = setTimer(() => waiter(null), rowWaitMs);
			if (!awaited.has(sitePath)) awaited.set(sitePath, new Set());
			awaited.get(sitePath).add(waiter);
		});
	};
	return {
		/**
		 * The window itself, for what is about no site yet: making one.
		 *
		 * @param {(action: string, params: Object) => Promise<Object>} perform
		 * @return {Function} Takes it out again.
		 */
		registerApp(perform) {
			app = perform;
			return () => { if (app === perform) app = null; };
		},
		/**
		 * @param {string}                                              sitePath
		 * @param {(action: string, params: Object) => Promise<Object>} perform  Resolves to a reply, or to nothing for an action the row does not have.
		 * @return {Function} Takes the row out again.
		 */
		register(sitePath, perform) {
			rows.set(sitePath, perform);
			for (const waiter of [...(awaited.get(sitePath) || [])]) waiter(perform);
			return () => { if (rows.get(sitePath) === perform) rows.delete(sitePath); };
		},
		/**
		 * Never rejects: whatever goes wrong is the reply.
		 *
		 * @param {Object} request `{ action, sitePath, params }`, from main.
		 * @return {Promise<Object>}
		 */
		async handle(request) {
			const forApp = request && (request.sitePath === null || request.sitePath === undefined);
			const perform = request && (forApp ? app : await rowFor(request.sitePath));
			if (!perform) return refusal('site-not-open', 'The app’s window has no such site open. It may still be being created or deleted.');
			try {
				const reply = await perform(request.action, request.params || {});
				return reply || refusal('unknown-action', `The window cannot do: ${String(request.action).slice(0, 80)}`);
			} catch (e) {
				return refusal('failed', String(e && e.message ? e.message : e));
			}
		}
	};
}

/**
 * The answers a row owes, each waiting for the page's state to say how what
 * was pressed ended. The row calls `settle` with its state after every
 * render; an outcome answers null while it has nothing to say.
 *
 * @param {Object}   [root0]
 * @param {Function} [root0.setTimer]
 * @param {Function} [root0.clearTimer]
 * @param {number}   [root0.startGraceMs]
 * @return {{wait: (outcome: Function, timeoutMs?: number) => Promise<Object>, settle: (snapshot: Object) => void, abandon: () => void}}
 */
function createOutcomeWaiters({ setTimer = setTimeout, clearTimer = clearTimeout, startGraceMs = START_GRACE_MS } = {}) {
	const waiting = new Set();
	let last = null;
	const finish = (waiter, reply) => {
		if (!waiting.delete(waiter)) return;
		clearTimer(waiter.timer);
		clearTimer(waiter.grace);
		waiter.resolve(reply);
	};
	return {
		/**
		 * Answers when `outcome` does. An outcome that can say whether what
		 * was pressed ever began (`hasBegun`) is given a moment to, and is
		 * answered as turned away if it has not.
		 *
		 * @param {Function} outcome     Takes the row's state; answers a reply, or null while there is none.
		 * @param {number}   [timeoutMs]
		 * @return {Promise<Object>}
		 */
		wait(outcome, timeoutMs = OUTCOME_TIMEOUT_MS) {
			return new Promise((resolve) => {
				const waiter = { outcome, resolve, timer: null, grace: null, gone: refusal('site-not-open', 'The site was closed in the app before it finished.') };
				waiter.timer = setTimer(() => finish(waiter, refusal('timed-out', 'The app is still working on it. Look at its window, or ask again later.')), timeoutMs);
				if (typeof outcome.hasBegun === 'function') {
					waiter.grace = setTimer(() => {
						if (!outcome.hasBegun()) finish(waiter, refusal('busy', 'The app did not start that: something else took the site’s terminal first. Try again when it has finished.'));
					}, startGraceMs);
				}
				waiting.add(waiter);
			});
		},
		/**
		 * Resolves to whether the row's state came to satisfy `predicate`,
		 * looking at the state it has now first.
		 *
		 * @param {Function} predicate
		 * @param {number}   timeoutMs
		 * @return {Promise<boolean>}
		 */
		until(predicate, timeoutMs) {
			if (last && predicate(last)) return Promise.resolve(true);
			return new Promise((resolve) => {
				const waiter = { outcome: (snapshot) => (predicate(snapshot) ? true : null), resolve, timer: null, grace: null, gone: false };
				waiter.timer = setTimer(() => finish(waiter, false), timeoutMs);
				waiting.add(waiter);
			});
		},
		settle(snapshot) {
			last = snapshot;
			for (const waiter of [...waiting]) {
				const reply = waiter.outcome(snapshot);
				if (reply) finish(waiter, reply);
			}
		},
		// The row is going away: a site deleted, a window closing.
		abandon() {
			for (const waiter of [...waiting]) finish(waiter, waiter.gone);
		}
	};
}

// What a row is doing that no request may start under: the same states its
// own buttons are held in.
function heldBy(snapshot) {
	if (snapshot.held) return refusal('busy', 'The site is busy in the app: it is being set up, updated or deleted. Try again when that has finished.');
	return null;
}

/**
 * What to do with "start the server", from the row's state.
 *
 * @param {Object} snapshot
 * @return {{refuse?: Object, done?: Object, wait?: boolean, press?: boolean}}
 */
function serverStartPlan(snapshot) {
	const { server } = snapshot;
	if (server.running && server.url) return { done: ok({ url: server.url, started: false }) };
	// Already on its way, by a press of the person's or an earlier request:
	// this one waits for the same end.
	if (server.starting || server.running) return { wait: true };
	const held = heldBy(snapshot);
	if (held) return { refuse: held };
	if (!snapshot.canServe) return { refuse: refusal('not-built', 'The site has not been built yet, so there is nothing to serve. Finish its setup in the app first.') };
	return { press: true };
}

/**
 * How a start ended, or null while it has not. `begun` is whether the start
 * was already on its way when this began to watch: a failure the page still
 * shows from an earlier start is not this one's, so nothing is read as an
 * end until the page has been seen starting.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.begun]
 * @return {(snapshot: Object) => ?Object}
 */
function serverStartOutcome({ begun = false } = {}) {
	let seen = begun;
	return ({ server }) => {
		if (server.running && server.url) return ok({ url: server.url, started: true });
		if (server.starting || server.running) {
			seen = true;
			return null;
		}
		if (!seen) return null;
		return refusal('server-failed', server.failure || 'The server did not start. The Logs panel in the app has its last lines.');
	};
}

function serverStopPlan(snapshot) {
	const { server } = snapshot;
	if (!server.running && !server.starting) return { done: ok({ stopped: false }) };
	// The page's own button does nothing while a start is on its way.
	if (!server.running) return { refuse: refusal('busy', 'The server is still starting. Ask again once it is running.') };
	return { press: true };
}

function serverStopOutcome() {
	return ({ server }) => (!server.running && !server.starting ? ok({ stopped: true }) : null);
}

// The end of a command's output that an answer carries: enough to read why
// a build failed, without a build's whole output in a tool's context.
const MAX_OUTPUT = 12000;
function tailOfOutput(text, max = MAX_OUTPUT) {
	const output = String(text);
	return output.length > max ? output.slice(-max) : output;
}

// Scripts on the terminal's list that never end by themselves. Run from a
// tool they would hold the terminal, and the tool, until someone stopped
// them; the build watch has its own button, and starts with the server.
const WATCH_SCRIPTS = ['dev', 'watch'];

/**
 * Why a tool may not run `script`, or null. The list is the terminal's own,
 * so what a tool can run is what a person can type; `install` is npm install.
 *
 * @param {*}        script
 * @param {string[]} allowed The site's `allowedScripts`.
 * @return {?Object} A refusal.
 */
function scriptRefusal(script, allowed) {
	if (script === 'install') return null;
	if (typeof script !== 'string' || !allowed.includes(script)) {
		return refusal('unsupported-script', `That script cannot be run on this site. The scripts it has: ${['install', ...allowed.filter((name) => !WATCH_SCRIPTS.includes(name))].join(', ')}.`);
	}
	if (WATCH_SCRIPTS.includes(script)) {
		return refusal('unsupported-script', `npm run ${script} is a watch that does not end, and would hold the site’s terminal. Run the build after editing instead.`);
	}
	return null;
}

// A row that something else holds: a command in the terminal, an apply, an
// update, a ticket switch. The page's own buttons say this in the terminal
// or stay disabled; a tool is told.
function busyRefusal(snapshot) {
	const held = heldBy(snapshot);
	if (held) return held;
	if (snapshot.busy) return refusal('busy', 'The site is busy in the app: a command, an update or a switch is still running. Try again when it has finished.');
	return null;
}

/**
 * What main says of the site now: asked for, not read off the page, whose
 * copy is as old as its last reload of the status. Read before an action to
 * see whether there is anything to do, and after it to say what was done.
 *
 * @param {Object} ctx
 * @return {Promise<Object>}
 */
async function siteState(ctx) {
	const status = (await ctx.latest().presses.readStatus()) || {};
	return {
		ticket: status.tracTicket || null,
		pullRequest: status.pullRequest ? status.pullRequest.number : null,
		appliedPatch: status.appliedPatch ? status.appliedPatch.label : null,
		buildFailed: Boolean(status.buildFailed),
		installFailed: Boolean(status.installFailed),
		updateIncomplete: Boolean(status.updateIncomplete)
	};
}

// Waits until the row is doing nothing, and answers with its state then.
// `begun` is for a wait that starts after the work has: see
// serverStartOutcome.
function idleOutcome({ begun = false } = {}) {
	let seen = begun;
	const outcome = (snapshot) => {
		if (snapshot.busy) {
			seen = true;
			return null;
		}
		return seen ? ok(snapshot) : null;
	};
	outcome.hasBegun = () => seen;
	return outcome;
}

// A build that failed after a change is the change's news: the tree is as
// asked, and the site is not usable until it builds.
function withBuildNews(result, state) {
	if (state.installFailed) return { ...result, warning: 'The change was made, but npm install failed after it. Its output is in the app’s terminal.' };
	if (state.buildFailed) return { ...result, warning: 'The change was made, but the build failed after it. Its output is in the app’s terminal.' };
	return result;
}

async function runScript({ latest }, params) {
	const { snapshot, presses } = latest();
	const refused = busyRefusal(snapshot) || scriptRefusal(params.script, snapshot.scripts);
	if (refused) return refused;
	const command = params.script === 'install' ? 'npm install' : `npm run ${params.script}`;
	const end = await presses.runTerminalCommand(command);
	if (end.refused === 'busy') return refusal('busy', 'A command is already running in the site’s terminal.');
	if (end.refused) return refusal('unsupported-script', 'The site’s terminal did not accept that command.');
	if (end.code !== 0) return { ...refusal('script-failed', `${command} exited with code ${end.code}.`), output: end.output };
	return ok({ command, code: 0, output: end.output });
}

// What a switch that the page refused says to a tool.
function switchRefusal(result) {
	if (result.code === 'busy') return refusal('busy', 'A command is already running in the site’s terminal. Stop it, or wait, before switching.');
	if (result.code === 'dirty-trunk') {
		const count = Number.isInteger(result.files) ? `${result.files} edited file(s)` : 'Edited files';
		return refusal('dirty-trunk', result.canCarry
			? `${count} on trunk would be left behind. The app is asking what to do with them in its window; or ask again with --carry to bring them into the ticket.`
			: `${count} on trunk would be left behind. The app is asking what to do with them in its window: save them as a patch or discard them there.`);
	}
	return refusal(result.code || 'failed', result.error || 'The app could not make that switch. Its window says why.');
}

async function switchTicket(ctx, ref, options) {
	const { snapshot, presses } = ctx.latest();
	const refused = busyRefusal(snapshot);
	if (refused) return refused;
	const result = await (ref === '' ? presses.unlinkTicket() : presses.linkRef(ref, options));
	// A press the page turned away before it began answers nothing.
	if (!result) return refusal('failed', 'The app did not make that switch. Its window says why.');
	if (!result.ok) return switchRefusal(result);
	// A switch that put a pull request back rebuilds around it, and is not
	// over until that is.
	if (result.rebuilding) await ctx.waiters.wait(idleOutcome({ begun: true }));
	return ok(withBuildNews({ ticket: result.ticket, branch: result.branch, rebuilt: Boolean(result.rebuilding) }, await siteState(ctx)));
}

async function linkTicket(ctx, params) {
	const ref = typeof params.ref === 'string' || typeof params.ref === 'number' ? String(params.ref).trim() : '';
	if (!ref) return refusal('invalid-request', 'Name the ticket or issue to link, by its number or its address.');
	return switchTicket(ctx, ref, params.carry === true ? { carryTrunkWork: true } : undefined);
}

async function unlinkTicket(ctx) {
	if (!(await siteState(ctx)).ticket) return ok({ ticket: null, branch: null, rebuilt: false });
	return switchTicket(ctx, '', undefined);
}

// How a preview the row asked for ended: it is there, or the page says why
// it is not. `key` is what the page shows as being fetched meanwhile.
function previewOutcome(key, matches) {
	let seen = false;
	return ({ apply }) => {
		if (apply.fetching === key) {
			seen = true;
			return null;
		}
		if (apply.preview && matches(apply.preview)) return ok(apply.preview);
		if (!seen) return null;
		return refusal('preview-failed', apply.error || 'The app could not read that. Its window says why.');
	};
}

// How an apply or a checkout the row began ended, read once the row is
// idle: refused with the page's own words, or done. What was done is main's
// to say, and is asked for after.
function applyOutcome() {
	const idle = idleOutcome();
	const outcome = (snapshot) => {
		if (!idle(snapshot)) return null;
		const { apply, ticket } = snapshot;
		if (ticket.blocked) return switchRefusal({ code: 'dirty-trunk', canCarry: false, files: ticket.blocked.files });
		if (apply.error) return refusal('apply-failed', apply.error);
		return ok({});
	};
	outcome.hasBegun = idle.hasBegun;
	return outcome;
}

async function checkoutPullRequest(ctx, params) {
	const number = Number(params.number);
	if (!Number.isInteger(number) || number < 1) return refusal('invalid-request', 'Name the pull request by its number.');
	const refused = busyRefusal(ctx.latest().snapshot);
	if (refused) return refused;
	if ((await siteState(ctx)).pullRequest === number) return ok({ pullRequest: number, checkedOut: false });
	const previewing = ctx.waiters.wait(previewOutcome(number, (preview) => preview.kind === 'pr' && preview.number === number));
	ctx.latest().presses.previewPullRequest(number);
	const preview = await previewing;
	if (!preview.ok) return preview;
	// The preview is a dialog on the page now; its own button is the press.
	const applying = ctx.waiters.wait(applyOutcome());
	ctx.latest().presses.applyPreview();
	const applied = await applying;
	if (!applied.ok) return applied;
	const state = await siteState(ctx);
	if (state.pullRequest !== number) return refusal('apply-failed', 'The pull request was not checked out. The app’s window says why.');
	return ok(withBuildNews({ pullRequest: number, checkedOut: true }, state));
}

async function leavePullRequest(ctx) {
	if ((await siteState(ctx)).pullRequest === null) return ok({ pullRequest: null, left: false });
	const { snapshot, presses } = ctx.latest();
	const refused = busyRefusal(snapshot);
	if (refused) return refused;
	const leaving = ctx.waiters.wait(applyOutcome());
	presses.leavePullRequest();
	const left = await leaving;
	if (!left.ok) return left;
	const state = await siteState(ctx);
	if (state.pullRequest !== null) return refusal('apply-failed', 'The pull request is still checked out. The app’s window says why.');
	return ok(withBuildNews({ pullRequest: null, left: true, ticket: state.ticket }, state));
}

// How a read of the ticket's patches ended: both lists are in, or one of
// the two reads failed.
function patchListOutcome() {
	let seen = false;
	const outcome = ({ patches }) => {
		if (patches.attachmentsLoading || patches.prsLoading) {
			seen = true;
			return null;
		}
		if (!seen) return null;
		if (patches.prsStatus === 'error') return refusal('patches-failed', 'The app could not read the ticket’s pull requests from GitHub. Ask again in a little while.');
		if (patches.isTrac && patches.attachmentsStatus === 'error') return refusal('trac-failed', 'The app could not read the ticket’s attachments from Trac. If Trac asked for a human check, answer it in the app’s window and ask again.');
		return ok(patches);
	};
	outcome.hasBegun = () => seen;
	return outcome;
}

async function applyLatestPatch(ctx, _params, { pickLatest }) {
	const first = ctx.latest();
	const refused = busyRefusal(first.snapshot);
	if (refused) return refused;
	const before = await siteState(ctx);
	if (!before.ticket) return refusal('no-ticket', 'No ticket is linked to this site. Link one first: the latest patch is the linked ticket’s.');
	if (before.appliedPatch) return refusal('already-applied', `${before.appliedPatch} is already applied. Revert it in the app before applying another.`);
	// Both lists are read now, by the card's own two reads. The page reads
	// the pull requests only for the site that is on screen, and the
	// attachments only when asked, a visit to Trac in a window of the app's;
	// choosing the latest from a list never read would choose wrongly.
	const listing = ctx.waiters.wait(patchListOutcome());
	first.presses.loadTicketPatches();
	if (first.snapshot.patches.isTrac) first.presses.loadTracAttachments();
	const listed = await listing;
	if (!listed.ok) return listed;
	const patches = listed.result;
	const latest = pickLatest({ prs: patches.prs, attachments: patches.isTrac ? patches.attachments : [], prRankComplete: patches.prRankComplete });
	if (!latest) return refusal('no-latest-patch', 'The app cannot say which of the ticket’s patches is the latest: there is none, or two are too close to call. Choose one in the app’s window.');
	if (latest.kind === 'pr') return checkoutPullRequest(ctx, { number: latest.key });

	const attachment = patches.attachments.find((item) => (item.url || item.filename) === latest.key);
	if (!attachment || !attachment.url) return refusal('no-latest-patch', 'The latest patch on the ticket cannot be fetched. Choose one in the app’s window.');
	const previewing = ctx.waiters.wait(previewOutcome(attachment.url, (preview) => preview.kind !== 'pr' && preview.label === attachment.filename));
	ctx.latest().presses.previewAttachment(attachment);
	const preview = await previewing;
	if (!preview.ok) return preview;
	const applying = ctx.waiters.wait(applyOutcome());
	ctx.latest().presses.applyPreview();
	const applied = await applying;
	if (!applied.ok) return applied;
	const state = await siteState(ctx);
	if (state.appliedPatch !== attachment.filename) return refusal('apply-failed', 'The patch was not applied. The app’s window says why.');
	return ok(withBuildNews({ appliedPatch: attachment.filename }, state));
}

// How a trunk update ended, as far as the page knows: it asked a question,
// it could not fetch, or it is over. The page asks first when there are
// edits an update would reset, in a dialog; a tool is told, and the dialog
// is the person's to answer.
function updateOutcome() {
	let seen = false;
	const outcome = (snapshot) => {
		const { update } = snapshot;
		if (update.dirtyOpen) return refusal('dirty', 'The site has edits an update would reset. The app is asking what to do with them in its window: save them as a patch or discard them there.');
		if (update.state !== 'idle' || snapshot.busy) {
			seen = true;
			return null;
		}
		if (!seen) return null;
		if (update.failed) return refusal('update-failed', 'The update could not get the latest trunk. Why is in the app’s terminal.');
		return ok({ updated: Boolean(update.summary) });
	};
	// A question asked is a beginning too: it is answered by the first
	// branch above, before any grace runs out.
	outcome.hasBegun = () => seen;
	return outcome;
}

async function updateTrunk(ctx) {
	const { snapshot, presses } = ctx.latest();
	const refused = busyRefusal(snapshot);
	if (refused) return refused;
	const updating = ctx.waiters.wait(updateOutcome());
	presses.startTrunkUpdate();
	const updated = await updating;
	if (!updated.ok) return updated;
	const state = await siteState(ctx);
	// The tree is the new trunk and the build around it is not: the page
	// keeps saying so until a build passes, and so does this.
	if (state.updateIncomplete) return refusal('update-failed', 'Trunk was updated, but the install or the build after it failed, so the site is not usable yet. Its output is in the app’s terminal.');
	return ok({ updated: updated.result.updated, upToDate: !updated.result.updated });
}

// Each action a row has. The two the server has are a press and a state to
// read; the rest are a few presses in a row, each waited for.
const SITE_ACTIONS = {
	'site.server.start': { plan: serverStartPlan, press: 'toggleDevServer', outcome: (plan) => serverStartOutcome({ begun: Boolean(plan.wait) }) },
	'site.server.stop': { plan: serverStopPlan, press: 'toggleDevServer', outcome: () => serverStopOutcome() },
	'site.script.run': { run: runScript },
	'site.ticket.link': { run: linkTicket },
	'site.ticket.unlink': { run: unlinkTicket },
	'site.pr.checkout': { run: checkoutPullRequest },
	'site.pr.leave': { run: leavePullRequest },
	'site.patch.apply-latest': { run: applyLatestPatch },
	'site.trunk.update': { run: updateTrunk }
};

// The window's own question to a row: has everything you were running ended.
const SETTLED = 'site.settled';

/**
 * Carries out one request in a row.
 *
 * `latest` answers the row's state and its functions as they are now, not as
 * they were when the request came in: an action of several presses makes the
 * second in a later render than the first, with that render's functions.
 *
 * @param {string}   action
 * @param {Object}   params
 * @param {Object}   root0
 * @param {Function} root0.latest  Answers `{ snapshot, presses }`.
 * @param {Object}   root0.waiters From `createOutcomeWaiters`.
 * @param {Object}   [root0.deps]  What an action needs that is not the row's: `pickLatest`.
 * @return {Promise<?Object>} The reply, or null for an action a row does not have.
 */
async function performSiteControl(action, params, { latest, waiters, deps = {} }) {
	// Asked by the window itself, never by a tool: main forwards only the
	// names in its own map. A new site's row answers this once it has
	// nothing left running.
	if (action === SETTLED) {
		const settled = await waiters.until((snapshot) => !snapshot.loading && !snapshot.held && !snapshot.busy, OUTCOME_TIMEOUT_MS);
		return settled ? ok({}) : refusal('timed-out', 'The site is still being set up. Its page in the app shows how far it is.');
	}
	if (!Object.hasOwn(SITE_ACTIONS, action)) return null;
	// A row that has not read its site's status yet knows nothing an action
	// could be decided from. That read is a moment's; it is waited for.
	if (!(await waiters.until((snapshot) => !snapshot.loading, LOADING_WAIT_MS))) {
		return refusal('busy', 'The app is still reading that site. Try again in a moment.');
	}
	const entry = SITE_ACTIONS[action];
	if (entry.run) return entry.run({ latest, waiters }, params || {}, deps);
	const { snapshot, presses } = latest();
	const plan = entry.plan(snapshot);
	if (plan.refuse) return plan.refuse;
	if (plan.done) return plan.done;
	// Waiting before pressing: a press that ends at once is still seen.
	const reply = waiters.wait(entry.outcome(plan));
	if (plan.press) presses[entry.press]();
	return reply;
}

// How often main is asked whether a new site's setup has ended, and for how
// long. A first install and build of wordpress-develop is minutes on a fast
// machine and tens of minutes on a slow one.
const SETUP_POLL_MS = 2000;
const SETUP_TIMEOUT_MS = 80 * 60 * 1000;

/**
 * Waits for a site that was just cloned to be installed and built, which the
 * site's row starts by itself once the clone ends. Read from main's status
 * and not from the row: the row is still being mounted when this begins.
 *
 * @param {string}   sitePath
 * @param {Object}   root0
 * @param {Function} root0.readStatus
 * @param {Function} [root0.sleep]
 * @param {Function} [root0.now]
 * @param {number}   [root0.timeoutMs]
 * @return {Promise<Object>}
 */
async function waitForSetup(sitePath, { readStatus, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now, timeoutMs = SETUP_TIMEOUT_MS }) {
	const deadline = now() + timeoutMs;
	for (;;) {
		const status = (await readStatus(sitePath)) || {};
		if (status.installFailed) return refusal('setup-failed', 'The site was created, but npm install failed. Its output is in the app’s terminal; the site’s page offers to run it again.');
		if (status.buildFailed) return refusal('setup-failed', 'The site was created, but its first build failed. Its output is in the app’s terminal; the site’s page offers to run it again.');
		if (status.hasNodeModules && status.hasBuilt) return ok({});
		if (now() >= deadline) return refusal('timed-out', 'The site was created and is still being set up. Its page in the app shows how far it is.');
		await sleep(SETUP_POLL_MS);
	}
}

const PROJECTS = ['core', 'gutenberg'];

async function createSite(ctx, params, deps = {}) {
	const { snapshot, presses } = ctx.latest();
	const name = typeof params.name === 'string' ? params.name.trim() : '';
	if (!name) return refusal('invalid-request', 'Give the new site a name.');
	const project = params.project === undefined || params.project === null ? 'core' : params.project;
	if (!PROJECTS.includes(project)) return refusal('invalid-request', `A site is ${PROJECTS.join(' or ')}.`);
	const folder = typeof params.folder === 'string' && params.folder ? params.folder : snapshot.defaultFolder;
	if (!folder) return refusal('no-folder', 'Say which folder to make the site in with --folder, or choose the folder for new sites in the app’s Settings.');
	// The page makes one site at a time, and so does a tool.
	if (snapshot.creating) return refusal('busy', 'The app is already creating a site. Ask again when that one is done.');
	const created = await presses.startSiteSetup({ name, dir: folder, projectType: project });
	if (!created || !created.ok) return refusal('setup-failed', (created && created.error) || 'The site could not be created. The app’s window says why.');
	const ready = await waitForSetup(created.path, { readStatus: presses.readStatus, ...deps });
	if (!ready.ok) return { ...ready, site: created.path };
	// The folder that says "built" is there before the build that makes it
	// has ended: the site is ready once its row has nothing left running.
	const settled = await presses.whenSettled(created.path);
	if (!settled.ok) return { ...settled, site: created.path };
	return ok({ site: created.path, project, name });
}

// What the window does that is about no site.
const APP_ACTIONS = {
	'sites.create': createSite
};

/**
 * Carries out one request that is the window's and not a row's.
 *
 * @param {string}   action
 * @param {Object}   params
 * @param {Object}   root0
 * @param {Function} root0.latest Answers `{ snapshot, presses }`.
 * @param {Object}   [root0.deps] `sleep`, `now` and `timeoutMs`, for tests.
 * @return {?Promise<Object>}
 */
function performAppControl(action, params, { latest, deps = {} }) {
	if (!Object.hasOwn(APP_ACTIONS, action)) return null;
	return Promise.resolve(APP_ACTIONS[action]({ latest }, params || {}, deps));
}

module.exports = {
	SETTLED,
	ROW_WAIT_MS,
	START_GRACE_MS,
	rowActivity,
	APP_ACTIONS,
	SETUP_POLL_MS,
	waitForSetup,
	performAppControl,
	OUTCOME_TIMEOUT_MS,
	MAX_OUTPUT,
	SITE_ACTIONS,
	tailOfOutput,
	scriptRefusal,
	idleOutcome,
	previewOutcome,
	applyOutcome,
	patchListOutcome,
	updateOutcome,
	createControlRegistry,
	createOutcomeWaiters,
	serverStartPlan,
	serverStartOutcome,
	serverStopPlan,
	serverStopOutcome,
	performSiteControl
};
