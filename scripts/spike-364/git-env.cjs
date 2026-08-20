/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * Spike #364 — resolving the bundled Git, in development and packaged.
 *
 * Throwaway. Nothing here is meant to land: it exists so the probes can find
 * the binary the same way `src/main.js` would have to, and so the environment
 * question is answered explicitly rather than inherited from the host.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );

/**
 * dugite lands in node_modules, so in a packaged app its tree is inside
 * app.asar and cannot be executed from there. `asarUnpack` puts it in
 * app.asar.unpacked; this is the resolution that goes with it.
 */
function resolveGitRoot() {
	const fromDugite = path.join( require.resolve( 'dugite' ), '..', '..', '..', 'git' );
	const unpacked = fromDugite.replace( `app.asar${ path.sep }`, `app.asar.unpacked${ path.sep }` );
	if ( fs.existsSync( path.join( unpacked, 'bin' ) ) ) return unpacked;
	return fromDugite;
}

function gitBinary( root = resolveGitRoot() ) {
	return path.join( root, 'bin', process.platform === 'win32' ? 'git.exe' : 'git' );
}

/**
 * Everything the bundled Git must be told, and nothing it should inherit.
 *
 * `--exec-path` resolves to `//libexec/git-core` when GIT_EXEC_PATH is unset,
 * so it is not optional. The rest is the second invariant of #350 read
 * forwards: a Git that picks up the host's global or system config is a Git
 * whose behaviour the app cannot predict.
 */
function gitEnv( root = resolveGitRoot(), extra = {} ) {
	const env = {
		...process.env,
		GIT_EXEC_PATH: path.join( root, 'libexec', 'git-core' ),
		GIT_TEMPLATE_DIR: path.join( root, 'share', 'git-core', 'templates' ),
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
		GIT_ASKPASS: '',
		// No interactive credential helper, ever: every fetch the app makes is
		// anonymous over public HTTPS.
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'credential.helper',
		GIT_CONFIG_VALUE_0: '',
		...extra,
	};
	const caBundle = path.join( root, 'etc', 'ssl', 'cert.pem' );
	if ( fs.existsSync( caBundle ) ) env.GIT_SSL_CAINFO = caBundle;
	return env;
}

module.exports = { resolveGitRoot, gitBinary, gitEnv };
