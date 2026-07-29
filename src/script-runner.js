const path = require('path');
const { hideChildWindows } = require('./hide-child-windows');

// Must run before npm's CLI is required: it is what spawns cmd.exe for the
// script body, and those spawns would otherwise pop up console windows.
hideChildWindows();

async function main() {
	const targetDir = process.argv[2];
	const scriptName = process.argv[3];
	const scriptArgs = process.argv.slice(4);
	if (!targetDir || !scriptName) {
		console.error('Usage: script-runner <dir> <script> [args...]');
		process.exit(1);
	}

	process.chdir(path.resolve(targetDir));

	try {
		const npmPkgJsonPath = require.resolve('npm/package.json');
		const npmRootDir = path.dirname(npmPkgJsonPath);
		const npmCliAbsPath = path.join(npmRootDir, 'bin', 'npm-cli.js');

		// argv for npm run-script: node npm run <script> -- <args>
		process.argv = [
			process.execPath,
			'npm',
			'run',
			scriptName,
			// '--',
			...scriptArgs
		];
		process.env.npm_config_loglevel = process.env.npm_config_loglevel || 'verbose';
		process.env.npm_config_progress = 'false';
		// Ensure npm uses our Electron Node and JS CLI, not cmd shims
		process.env.npm_node_execpath = process.execPath;
		process.env.npm_execpath = npmCliAbsPath;

		require(npmCliAbsPath);
	} catch (err) {
		console.error(err && err.stack ? err.stack : String(err));
		process.exit(1);
	}
}

main();


