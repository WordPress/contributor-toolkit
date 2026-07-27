// Helpers for spawning npm on Electron's bundled Node runtime.
// Deliberately free of Electron imports so it can be unit-tested.

const WINDOWS_PATHEXT = [
	'.COM', '.EXE', '.BAT', '.CMD', '.VBS', '.VBE', '.JS', '.JSE', '.WSF', '.WSH', '.MSC'
].join(';');

// Relaxes `engine-strict`, which wordpress-develop's .npmrc turns on. Passed as
// an environment variable rather than a CLI flag so it also reaches nested npm
// invocations made by WordPress's own scripts (e.g. the Gutenberg sync npm ci).
const RELAXED_ENGINES_ENV = { npm_config_engine_strict: 'false' };

// True when npm output blames an engines mismatch. Kept narrow on purpose: a
// failure for any other reason must not trigger the relaxed-engines retry.
// Note npm prints EBADENGINE as a warning too when engine-strict is off, so
// callers must also require a non-zero exit code.
function isEngineMismatch(text) {
	if (!text) return false;
	return /EBADENGINE/.test(text)
		|| /Not compatible with your version of node/i.test(text);
}

// Longest phrase isEngineMismatch looks for is ~40 chars; 64 is a safe overlap.
const CHUNK_OVERLAP = 64;

// Stateful detector for streamed output. Child stdout/stderr arrives in
// arbitrary chunks, so a marker can straddle a chunk boundary; carrying a short
// tail across calls keeps it detectable without buffering the whole log.
function createEngineMismatchDetector() {
	let tail = '';
	let found = false;
	return {
		push(text) {
			if (!found && isEngineMismatch(tail + text)) found = true;
			tail = String(text || '').slice(-CHUNK_OVERLAP);
			return found;
		},
		get found() {
			return found;
		}
	};
}

// Decides whether a finished npm run earns a second attempt with engine checks
// relaxed. Retrying is only ever right for an engines failure that the process
// reached on its own: a run the user cancelled (or the OS killed) must stay
// dead, otherwise pressing "stop" would silently start the work over.
function shouldRetryWithRelaxedEngines({ code, signal, sawEngineMismatch, alreadyRelaxed, cancelled }) {
	if (alreadyRelaxed) return false;
	if (cancelled) return false;
	// A non-null signal means the process was terminated rather than exiting.
	// Windows kills surface as a plain non-zero code, hence the `cancelled` flag.
	if (signal != null) return false;
	if (code === 0) return false;
	return Boolean(sawEngineMismatch);
}

// The env block for a spawned npm runner. On Windows both PATH and Path are set
// and PATHEXT is extended so child npm processes can find the node shim.
function buildChildEnv({
	shimDir,
	extraEnv = {},
	baseEnv = process.env,
	platform = process.platform,
	execPath = process.execPath
} = {}) {
	const isWindows = platform === 'win32';
	const separator = isWindows ? ';' : ':';
	const basePath = isWindows
		? (baseEnv.Path || baseEnv.PATH || '')
		: (baseEnv.PATH || '');
	const joinedPath = basePath ? `${shimDir}${separator}${basePath}` : String(shimDir);
	const env = {
		...baseEnv,
		ELECTRON_RUN_AS_NODE: '1',
		NODE: execPath,
		npm_config_production: 'false',
		NODE_ENV: 'development',
		PATH: joinedPath,
		PATHEXT: isWindows ? WINDOWS_PATHEXT : baseEnv.PATHEXT
	};
	if (isWindows) {
		env.Path = joinedPath;
	}
	return { ...env, ...extraEnv };
}

module.exports = {
	isEngineMismatch,
	createEngineMismatchDetector,
	shouldRetryWithRelaxedEngines,
	buildChildEnv,
	RELAXED_ENGINES_ENV
};
