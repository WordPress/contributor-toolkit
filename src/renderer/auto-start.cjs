'use strict';

/**
 * What opening a site starts (#559): the server, the watch, as the settings
 * say, and what the last quit left for the site to start again.
 *
 * Each is an edge, consumed once: the row becoming the open one, and the
 * list the quit left being read. The row keeps two flags for them and asks
 * here, once the site is ready for a start, what to consume and what to
 * start. Kept as a pure module so `node --test` covers the decision; the
 * row keeps the gates (the site's status read, nothing under way) and the
 * calls.
 *
 * @param {Object}  root0
 * @param {boolean} root0.open     The row became the open one and has not asked since.
 * @param {boolean} root0.isActive The row is the open one now.
 * @param {boolean} root0.resumed  The list the quit left has been acted on.
 * @param {?Object} root0.resume   What the list says for this site, `{ server, watch }`, or null for nothing.
 * @param {Object}  root0.settings The settings, with `autoStartServer` and `autoStartWatch`.
 * @return {{consumeOpen: boolean, consumeResume: boolean, server: boolean, watch: boolean}} Which edges to consume, and what to start.
 */
function autoStartPlan({ open, isActive, resumed, resume, settings }) {
	const plan = { consumeOpen: false, consumeResume: false, server: false, watch: false };
	if (open && isActive) {
		plan.consumeOpen = true;
		plan.server = Boolean(settings.autoStartServer);
		plan.watch = Boolean(settings.autoStartWatch);
	}
	if (!resumed && resume) {
		plan.consumeResume = true;
		if (resume.server) plan.server = true;
		if (resume.watch) plan.watch = true;
	}
	return plan;
}

module.exports = { autoStartPlan };
