/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * Spike #364 — resolving the bundled Git, in development and packaged.
 *
 * Throwaway. It delegates to dugite rather than joining paths by hand, which is
 * a finding rather than a convenience: the layout differs per platform in three
 * places at once. On Windows the binary is `git/cmd/git.exe` and not
 * `git/bin/git`, the exec path is under `git/mingw64/libexec/git-core`, and
 * `PATH` has to carry `mingw64/bin` and `mingw64/usr/bin` or the helpers Git
 * shells out to are not found. A first pass at this spike hand-rolled the macOS
 * layout, and every Windows check failed on that alone.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const dugite = require( 'dugite' );

/**
 * dugite already rewrites `app.asar` to `app.asar.unpacked`, which is the
 * resolution that goes with the `asarUnpack` rule this spike adds. Nothing here
 * has to know about packaging.
 */
function resolveGitRoot() {
	return dugite.resolveGitDir();
}

function gitBinary() {
	return dugite.setupEnvironment( {} ).gitLocation;
}

/**
 * Everything the bundled Git must be told, and nothing it should inherit.
 *
 * `setupEnvironment` covers the layout: GIT_EXEC_PATH (without which
 * `--exec-path` reads `//libexec/git-core`), the Windows PATH prefix, the
 * template dir, and dugite's own system gitconfig on macOS and Linux.
 *
 * The rest is #350's second invariant read forwards: a Git that picks up the
 * host's global config, or asks a human for credentials, is a Git whose
 * behaviour the app cannot predict. Every fetch this app makes is anonymous
 * over public HTTPS, so there is nothing to authenticate and nothing to prompt
 * for.
 */
function gitEnv( extra = {} ) {
	const { env } = dugite.setupEnvironment( {
		// dugite's own system gitconfig `include`s the host's /etc/gitconfig, so
		// without this the app would inherit whatever a mentor's machine sets.
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
		GIT_ASKPASS: '',
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'credential.helper',
		GIT_CONFIG_VALUE_0: '',
		...extra,
	} );
	return env;
}

module.exports = { resolveGitRoot, gitBinary, gitEnv, dugite, fs, path };
