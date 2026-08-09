'use strict';

/**
 * The one HTTP call this app makes to GitHub.
 *
 * Requests ride Electron's `net` rather than a new HTTP dependency: it uses the
 * Chromium network stack, so it honours the same proxy and TLS configuration
 * the rest of the app already relies on, and adds nothing to install.
 *
 * This started as `httpGet` inside github-prs.js, which is a module about
 * *reading* pull requests. Opening one (#167) needs POST, a request body and an
 * Authorization header, so the primitive moved here and grew a method — the
 * alternative was a second, subtly different request function in the module
 * that writes.
 *
 * Two properties are deliberate and every caller depends on them:
 *
 * It never rejects on an HTTP status. A 403 from a spent rate limit, a 404 from
 * an application without device flow enabled and a 422 from a branch that
 * already exists are all *data* the caller classifies and turns into something
 * a contributor can act on. Only a transport failure or a timeout rejects.
 *
 * And the network client and the timers are injectable, so the response,
 * transport-error, timeout and settle-once paths are all exercised by
 * `node --test` without a network or a real 15-second wait. Production callers
 * pass none of that and get Electron's `net` and the global timers.
 */

// GitHub rejects API requests with no User-Agent; an identifying one is also
// the honest thing to send.
const USER_AGENT = 'WordPress-Contributor-Toolkit (+https://github.com/WordPress/experimental-wp-dev-env)';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Opt-in wire log for the one bug that survives every reproduction: set
 * WP_DEV_ENV_HTTP_LOG=1 and every GitHub request prints its method, URL and
 * status to the terminal the app was started from. Never the token, never the
 * body — the shape of the traffic, not its contents.
 *
 * @param {string} line
 */
function wireLog(line) {
	// eslint-disable-next-line no-console -- deliberate: this is the debug channel, enabled explicitly by env var.
	if (process.env.WP_DEV_ENV_HTTP_LOG) console.log(`[github-http] ${line}`);
}

/**
 * A single request over Electron net.
 *
 * `opts` carries both test doubles and request options. `partition` +
 * `useSessionCookies` let a caller ride a specific session's cookies — the Trac
 * attachment fetch reuses the session that passed the proof-of-work challenge,
 * so its `_hcc` cookie authorises the download; net does not send session
 * cookies unless asked, hence the explicit flag.
 *
 * @param {string}  method
 * @param {string}  url
 * @param {Object}  [headers]
 * @param {Object}  [opts]
 * @param {string}  [opts.body]              Serialised request body, already stringified.
 * @param {string}  [opts.token]             Sent as `Authorization: Bearer`; omitted entirely when absent.
 * @param {string}  [opts.partition]
 * @param {boolean} [opts.useSessionCookies]
 * @return {Promise<{status: number, headers: Object, body: string}>}
 */
function httpRequest(method, url, headers = {}, opts = {}) {
	// Required lazily, not at module load: requiring `electron` outside Electron
	// resolves the binary and can spawn its installer on a cold checkout, and the
	// standalone tests inject their own client and must never reach it.
	const netImpl = opts.net || require('electron').net;
	const setTimeoutImpl = opts.setTimeout || setTimeout;
	const clearTimeoutImpl = opts.clearTimeout || clearTimeout;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

		wireLog(`→ ${method} ${url}${opts.token ? ' (authorized)' : ''}`);
		const requestOptions = { method, url };
		// A token-bearing request never follows a redirect: whether Chromium's
		// stack would re-send the Authorization header to a different host is
		// not a question worth having an answer to. No GitHub endpoint this app
		// calls redirects, so in practice this changes nothing — until the day
		// something in the path does, when it fails closed instead of forwarding
		// a credential.
		if (opts.token) requestOptions.redirect = 'error';
		if (opts.partition) {
			requestOptions.partition = opts.partition;
			requestOptions.useSessionCookies = opts.useSessionCookies !== false;
		}
		const request = netImpl.request(requestOptions);
		request.setHeader('User-Agent', USER_AGENT);
		// Set before the caller's headers rather than after, so an explicit
		// Authorization in `headers` is the one that wins — there is no case for
		// a token silently overriding what a call site spelled out.
		if (opts.token) request.setHeader('Authorization', `Bearer ${opts.token}`);
		for (const [key, value] of Object.entries(headers)) request.setHeader(key, value);

		const timer = setTimeoutImpl(() => {
			try { request.abort(); } catch {}
			finish(reject, new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);

		request.on('response', (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => {
				clearTimeoutImpl(timer);
				const lowerHeaders = {};
				for (const [key, value] of Object.entries(response.headers || {})) {
					lowerHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
				}
				wireLog(`← ${response.statusCode} ${method} ${url}${lowerHeaders['x-github-request-id'] ? ` [${lowerHeaders['x-github-request-id']}]` : ''}`);
				finish(resolve, { status: response.statusCode, headers: lowerHeaders, body: Buffer.concat(chunks).toString('utf8') });
			});
			response.on('error', (e) => { clearTimeoutImpl(timer); finish(reject, e); });
		});
		request.on('error', (e) => { clearTimeoutImpl(timer); finish(reject, e); });
		if (opts.body !== undefined && opts.body !== null) request.write(opts.body);
		request.end();
	});
}

/**
 * @param {string} url
 * @param {Object} [headers]
 * @param {Object} [opts]
 * @return {Promise<{status: number, headers: Object, body: string}>}
 */
function httpGet(url, headers = {}, opts = {}) {
	return httpRequest('GET', url, headers, opts);
}

/**
 * A JSON POST, which is every write this app makes: request body serialised,
 * response parsed, and both content types stated.
 *
 * The response is returned alongside the parsed body rather than instead of it
 * — the status and headers are what the failure classification reads, and a
 * body that is not JSON (an HTML error page from a proxy) has to be survivable
 * rather than an exception.
 *
 * @param {string} url
 * @param {Object} payload
 * @param {Object} [opts]
 * @return {Promise<{status: number, headers: Object, body: string, json: Object|null}>}
 */
async function postJson(url, payload, opts = {}) {
	const res = await httpRequest('POST', url, {
		Accept: 'application/json',
		'Content-Type': 'application/json'
	}, { ...opts, body: JSON.stringify(payload || {}) });
	let json = null;
	try { json = JSON.parse(res.body); } catch { json = null; }
	return { ...res, json };
}

/**
 * A form-encoded POST with a JSON answer — the shape of GitHub's OAuth
 * endpoints under github.com/login/*, whose documented request format is
 * URL-encoded parameters even though they answer JSON when asked. The API
 * proper (api.github.com) takes JSON and uses postJson above; sending the
 * login endpoints their documented format instead of relying on them
 * tolerating JSON keeps the scope grant — the part that decides whether the
 * token can push at all — out of the realm of undocumented behaviour.
 *
 * @param {string} url
 * @param {Object} params
 * @param {Object} [opts]
 * @return {Promise<{status: number, headers: Object, body: string, json: Object|null}>}
 */
async function postForm(url, params, opts = {}) {
	const res = await httpRequest('POST', url, {
		Accept: 'application/json',
		'Content-Type': 'application/x-www-form-urlencoded'
	}, { ...opts, body: new URLSearchParams(params || {}).toString() });
	let json = null;
	try { json = JSON.parse(res.body); } catch { json = null; }
	return { ...res, json };
}

/**
 * A JSON GET, in the same shape as postJson so callers can treat the two alike.
 *
 * @param {string} url
 * @param {Object} [opts]
 * @return {Promise<{status: number, headers: Object, body: string, json: Object|null}>}
 */
async function getJson(url, opts = {}) {
	const res = await httpGet(url, { Accept: 'application/vnd.github+json' }, opts);
	let json = null;
	try { json = JSON.parse(res.body); } catch { json = null; }
	return { ...res, json };
}

module.exports = { USER_AGENT, REQUEST_TIMEOUT_MS, httpRequest, httpGet, postJson, postForm, getJson };
