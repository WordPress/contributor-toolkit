'use strict';

/**
 * Signing in to GitHub by device code (#167).
 *
 * The contributor never types a password into this app and this app never
 * writes a push credential to disk. It shows a short code; the browser takes
 * that code to github.com, where the sign-in actually happens; and the app
 * polls until GitHub says the authorization went through.
 *
 * Device flow is the only one of the three options that fits. Reusing an
 * existing `gh` CLI login is excellent for contributors who already have one
 * and useless for the first-timers this app is for. Pasting a personal access
 * token works everywhere and needs nothing registered, but it sends a newcomer
 * on a detour through token settings and scope choices, and it forces the app
 * to hold a long-lived credential.
 *
 * The client ID ships inside the binary, which is fine: device flow uses no
 * client secret, so nothing secret is distributed and there is nothing to leak.
 * What matters is who owns the application — an individually-owned one would
 * put that person's name on every contributor's consent screen and make every
 * install depend on one account continuing to exist. The application this ID
 * belongs to is owned by the WordPress organisation.
 *
 * Pure logic over an injected request function: no `electron` import, so
 * `node --test` exercises every poll outcome without a network or a real wait.
 */

const { postJson, getJson } = require('./github-http.cjs');

// The WordPress organisation's OAuth application, "WordPress Contributor
// Toolkit". An empty value here means this build has no sign-in configured,
// which `requestDeviceCode` reports as its own outcome rather than letting it
// surface as GitHub's indistinguishable 404.
const CLIENT_ID = 'Ov23liJ2H1gdqF2dTpMe';

// `public_repo` is fork, push and pull request on a public repository — the
// narrowest scope that can do this job. Anything wider would be asking a
// first-time contributor to grant more than the task needs.
const SCOPES = 'public_repo';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const VIEWER_URL = 'https://api.github.com/user';
const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// GitHub's documented floor when it has not said otherwise, and what it adds to
// the interval each time it answers `slow_down`.
const DEFAULT_INTERVAL_SECONDS = 5;
const SLOW_DOWN_BUMP_SECONDS = 5;

/**
 * The environment variable wins so a second application can be tested against
 * without a rebuild; the constant is what ships.
 *
 * @return {string}
 */
function getClientId() {
	const fromEnv = process.env.WP_DEV_ENV_GITHUB_CLIENT_ID;
	return (typeof fromEnv === 'string' && fromEnv.trim()) || CLIENT_ID;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Asks GitHub for a code to show the contributor.
 *
 * @param {Object}   [deps]
 * @param {Function} [deps.post]     Stands in for postJson.
 * @param {Function} [deps.now]      Stands in for Date.now.
 * @param {string}   [deps.clientId]
 * @return {Promise<{ok: true, userCode: string, verificationUri: string, deviceCode: string, interval: number, expiresAt: number}|{ok: false, reason: string, error: string}>}
 */
async function requestDeviceCode(deps = {}) {
	const post = deps.post || postJson;
	const now = deps.now || Date.now;
	// Present-but-empty is a real answer — "this build has no application" — so the
	// key's presence decides, not its truthiness.
	const clientId = 'clientId' in deps ? deps.clientId : getClientId();

	if (!clientId) {
		return {
			ok: false,
			reason: 'not-configured',
			error: 'This build has no GitHub application configured, so it cannot sign you in.'
		};
	}

	let res;
	try {
		res = await post(DEVICE_CODE_URL, { client_id: clientId, scope: SCOPES });
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}

	// A 404 here is the application not having device flow enabled, which is
	// otherwise indistinguishable from a wrong client ID — naming it is the
	// difference between a fixable message and half an hour of guessing.
	if (res.status === 404) {
		return {
			ok: false,
			reason: 'not-configured',
			error: 'GitHub does not recognise this application, or device flow is not enabled on it.'
		};
	}
	if (res.status !== 200 || !res.json || !res.json.device_code) {
		const detail = res.json && res.json.error_description ? res.json.error_description : `GitHub returned ${res.status}`;
		return { ok: false, reason: 'error', error: detail };
	}

	const json = res.json;
	const interval = Number(json.interval) > 0 ? Number(json.interval) : DEFAULT_INTERVAL_SECONDS;
	// GitHub's own expiry is the one that decides, but it is expressed as a
	// duration and every later comparison wants an instant.
	const expiresIn = Number(json.expires_in) > 0 ? Number(json.expires_in) : 900;
	return {
		ok: true,
		userCode: String(json.user_code || ''),
		verificationUri: String(json.verification_uri || 'https://github.com/login/device'),
		deviceCode: String(json.device_code),
		interval,
		expiresAt: now() + expiresIn * 1000
	};
}

/**
 * Waits for the contributor to finish in the browser.
 *
 * Every documented state is its own outcome rather than a generic failure,
 * because they call for different things from the UI: declining is a choice
 * that should cost nothing, an expired code wants a fresh one, and a spent
 * network wants the patch file offered instead.
 *
 * @param {Object}   root0
 * @param {string}   root0.deviceCode
 * @param {number}   root0.interval    Seconds, as GitHub reports them.
 * @param {number}   root0.expiresAt   Epoch milliseconds.
 * @param {Object}   [deps]
 * @param {Function} [deps.isCanceled] Polled between attempts; true stops the wait.
 * @return {Promise<{ok: true, token: string}|{ok: false, reason: string, error: string}>}
 */
async function pollForToken({ deviceCode, interval, expiresAt }, deps = {}) {
	const post = deps.post || postJson;
	const wait = deps.sleep || sleep;
	const now = deps.now || Date.now;
	const isCanceled = deps.isCanceled || (() => false);
	// Present-but-empty is a real answer — "this build has no application" — so the
	// key's presence decides, not its truthiness.
	const clientId = 'clientId' in deps ? deps.clientId : getClientId();

	let waitSeconds = Number(interval) > 0 ? Number(interval) : DEFAULT_INTERVAL_SECONDS;

	for (;;) {
		if (isCanceled()) return { ok: false, reason: 'canceled', error: 'Sign-in was canceled.' };
		await wait(waitSeconds * 1000);
		if (isCanceled()) return { ok: false, reason: 'canceled', error: 'Sign-in was canceled.' };
		// Checked after the wait rather than before it, so a code that expires
		// mid-sleep is reported as expired instead of being polled once more.
		if (now() >= expiresAt) {
			return { ok: false, reason: 'expired', error: 'The code expired before it was entered.' };
		}

		let res;
		try {
			res = await post(ACCESS_TOKEN_URL, {
				client_id: clientId,
				device_code: deviceCode,
				grant_type: GRANT_TYPE
			});
		} catch (e) {
			// A transport failure mid-poll is not a decision: the contributor may
			// simply have lost the network, and the authorization is still valid.
			return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
		}

		const json = res.json || {};
		if (json.access_token) return { ok: true, token: String(json.access_token) };

		switch (json.error) {
			case 'authorization_pending':
				break;
			case 'slow_down':
				// GitHub's own number when it sends one, and its documented bump
				// when it does not. Polling faster than it asks gets the device
				// code rejected outright.
				waitSeconds = Number(json.interval) > 0 ? Number(json.interval) : waitSeconds + SLOW_DOWN_BUMP_SECONDS;
				break;
			case 'expired_token':
				return { ok: false, reason: 'expired', error: 'The code expired before it was entered.' };
			case 'access_denied':
				return { ok: false, reason: 'denied', error: 'The authorization was declined on GitHub.' };
			default:
				return {
					ok: false,
					reason: 'error',
					error: json.error_description || json.error || `GitHub returned ${res.status}`
				};
		}
	}
}

/**
 * Who the token belongs to. The login is the fork's owner and the only part of
 * the sign-in the renderer is ever told.
 *
 * @param {string} token
 * @param {Object} [deps]
 * @return {Promise<{ok: true, login: string}|{ok: false, reason: string, error: string}>}
 */
async function fetchViewer(token, deps = {}) {
	const get = deps.get || getJson;
	let res;
	try {
		res = await get(VIEWER_URL, { token });
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
	if (res.status === 401) {
		return { ok: false, reason: 'unauthorized', error: 'That sign-in is no longer valid.' };
	}
	if (res.status !== 200 || !res.json || !res.json.login) {
		return { ok: false, reason: 'error', error: `GitHub returned ${res.status}` };
	}
	return { ok: true, login: String(res.json.login) };
}

module.exports = {
	CLIENT_ID,
	SCOPES,
	DEVICE_CODE_URL,
	ACCESS_TOKEN_URL,
	getClientId,
	requestDeviceCode,
	pollForToken,
	fetchViewer
};
