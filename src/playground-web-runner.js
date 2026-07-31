const path = require('path');
const { hideChildWindows } = require('./hide-child-windows');
const { bindLoopbackOnly } = require('./bind-loopback');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

// Same reason: the CLI calls `listen` with no address, so the patch has to be in
// place before it is loaded. Without it the dev site is served to the whole LAN.
bindLoopbackOnly();

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
            // No `host` here on purpose: RunCLIArgs has no such option, so
            // passing one only looked safe. bindLoopbackOnly() above is what
            // actually keeps this server off the network.
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



