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

/**
 * The rows that can be asked, by the site each is for.
 *
 * @return {{register: (sitePath: string, perform: Function) => Function, handle: (request: Object) => Promise<Object>}}
 */
function createControlRegistry() {
	const rows = new Map();
	return {
		/**
		 * @param {string}                                              sitePath
		 * @param {(action: string, params: Object) => Promise<Object>} perform  Resolves to a reply, or to nothing for an action the row does not have.
		 * @return {Function} Takes the row out again.
		 */
		register(sitePath, perform) {
			rows.set(sitePath, perform);
			return () => { if (rows.get(sitePath) === perform) rows.delete(sitePath); };
		},
		/**
		 * Never rejects: whatever goes wrong is the reply.
		 *
		 * @param {Object} request `{ action, sitePath, params }`, from main.
		 * @return {Promise<Object>}
		 */
		async handle(request) {
			const perform = request && rows.get(request.sitePath);
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
 * @return {{wait: (outcome: Function, timeoutMs?: number) => Promise<Object>, settle: (snapshot: Object) => void, abandon: () => void}}
 */
function createOutcomeWaiters({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
	const waiting = new Set();
	const finish = (waiter, reply) => {
		if (!waiting.delete(waiter)) return;
		clearTimer(waiter.timer);
		waiter.resolve(reply);
	};
	return {
		wait(outcome, timeoutMs = OUTCOME_TIMEOUT_MS) {
			return new Promise((resolve) => {
				const waiter = { outcome, resolve, timer: null };
				waiter.timer = setTimer(() => finish(waiter, refusal('timed-out', 'The app is still working on it. Look at its window, or ask again later.')), timeoutMs);
				waiting.add(waiter);
			});
		},
		settle(snapshot) {
			for (const waiter of [...waiting]) {
				const reply = waiter.outcome(snapshot);
				if (reply) finish(waiter, reply);
			}
		},
		// The row is going away: a site deleted, a window closing.
		abandon() {
			for (const waiter of [...waiting]) finish(waiter, refusal('site-not-open', 'The site was closed in the app before it finished.'));
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

// Each action a row has: what to do from its state, which of the row's
// functions is the press, and how to read the end.
const SITE_ACTIONS = {
	'site.server.start': { plan: serverStartPlan, press: 'toggleDevServer', outcome: (plan) => serverStartOutcome({ begun: Boolean(plan.wait) }) },
	'site.server.stop': { plan: serverStopPlan, press: 'toggleDevServer', outcome: () => serverStopOutcome() }
};

/**
 * Carries out one request in a row.
 *
 * @param {string}                   action
 * @param {Object}                   root0
 * @param {Object}                   root0.snapshot The row's state now.
 * @param {Object<string, Function>} root0.presses  The row's own functions, by name.
 * @param {Object}                   root0.waiters  From `createOutcomeWaiters`.
 * @return {?Promise<Object>} The reply, or null for an action a row does not have.
 */
function performSiteControl(action, { snapshot, presses, waiters }) {
	if (!Object.hasOwn(SITE_ACTIONS, action)) return null;
	const { plan: planFor, press, outcome } = SITE_ACTIONS[action];
	const plan = planFor(snapshot);
	if (plan.refuse) return Promise.resolve(plan.refuse);
	if (plan.done) return Promise.resolve(plan.done);
	// Waiting before pressing: a press that ends at once is still seen.
	const reply = waiters.wait(outcome(plan));
	if (plan.press) presses[press]();
	return reply;
}

module.exports = {
	OUTCOME_TIMEOUT_MS,
	SITE_ACTIONS,
	createControlRegistry,
	createOutcomeWaiters,
	serverStartPlan,
	serverStartOutcome,
	serverStopPlan,
	serverStopOutcome,
	performSiteControl
};
