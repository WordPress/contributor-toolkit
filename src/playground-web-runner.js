const path = require('path');
const { hideChildWindows } = require('./hide-child-windows');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

async function main() {
    const hostMountDir = process.argv[2];
    const desiredPort = Number(process.argv[3] || 39372);
    if (!hostMountDir) {
        console.error('No host mount directory provided');
        process.exit(1);
    }
    const absHost = path.resolve(hostMountDir);

    try {
		const { runCLI } = require('@wp-playground/cli');
		console.log("Running Playground Web Server from", absHost);
        const result = await runCLI({
            command: 'mount-only',
            host: '127.0.0.1',
            port: desiredPort,
            'mount': [ { hostPath: absHost, vfsPath: '/wordpress' } ],
            verbosity: 'debug'
        });

        const address = result.server.address();
        const port = typeof address === 'object' && address ? address.port : desiredPort;
        const url = `http://127.0.0.1:${port}/`;
        console.log(`WEB_SERVER_URL:${url}`);

        // Keep process alive until parent kills it
        process.on('SIGTERM', () => { try { process.exit(0); } catch {} });
        await new Promise(() => {});
    } catch (err) {
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
    }
}

main();



