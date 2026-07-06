const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	getSites: () => ipcRenderer.invoke('sites:get'),
	getSitesWithMeta: () => ipcRenderer.invoke('sites:getAll'),
	addSite: (dir) => ipcRenderer.invoke('sites:add', dir),
	chooseDirectory: () => ipcRenderer.invoke('dialog:choose-dir'),
	setupWordPress: (dir, options = {}) => ipcRenderer.invoke('wordpress:setup', dir, options),
	runNpmInstall: async (dir, onLog, onDone) => {
		const { installId } = await ipcRenderer.invoke('npm:install', dir);
		const logHandler = (_e, payload) => {
			if (payload.installId === installId && onLog) onLog(payload);
		};
		const doneHandler = (_e, payload) => {
			if (payload.installId === installId) {
				ipcRenderer.removeListener('npm:install:log', logHandler);
				ipcRenderer.removeListener('npm:install:done', doneHandler);
				if (onDone) onDone(payload);
			}
		};
		ipcRenderer.on('npm:install:log', logHandler);
		ipcRenderer.on('npm:install:done', doneHandler);
	}
,
	runNpmScript: async (dir, scriptName, scriptArgs, onLog, onDone) => {
		const { runId } = await ipcRenderer.invoke('npm:run-script', dir, scriptName, scriptArgs || []);
		const logHandler = (_e, payload) => {
			if (payload.runId === runId && onLog) onLog(payload);
		};
		const doneHandler = (_e, payload) => {
			if (payload.runId === runId) {
				ipcRenderer.removeListener('npm:run-script:log', logHandler);
				ipcRenderer.removeListener('npm:run-script:done', doneHandler);
				if (onDone) onDone(payload);
			}
		};
		ipcRenderer.on('npm:run-script:log', logHandler);
		ipcRenderer.on('npm:run-script:done', doneHandler);
		return { runId };
	}
,
	npmKill: (params) => ipcRenderer.invoke('npm:kill', params)
,
	openExternal: (url) => ipcRenderer.invoke('url:open', url)
,
	markSiteInitialized: (sitePath) => ipcRenderer.invoke('sites:mark-initialized', sitePath)
,
	forgetSite: (sitePath) => ipcRenderer.invoke('sites:forget', sitePath)
,
	deleteSite: (sitePath) => ipcRenderer.invoke('sites:delete', sitePath)

,
	setSiteLabel: (sitePath, label) => ipcRenderer.invoke('sites:set-label', sitePath, label)
,
	subscribeSetupProgress: (handler) => {
		const h = (_e, payload) => handler && handler(payload);
		ipcRenderer.on('download:progress', h);
		return () => ipcRenderer.removeListener('download:progress', h);
	}
,
	subscribeSetupStatus: (handler) => {
		const h = (_e, payload) => handler && handler(payload);
		ipcRenderer.on('download:status', h);
		return () => ipcRenderer.removeListener('download:status', h);
	}
,
	createPatchWindow: (sitePath) => ipcRenderer.invoke('git:create-patch', sitePath)
,
	getPatch: (sitePath) => ipcRenderer.invoke('git:get-patch', sitePath)
,
	savePatch: (sitePath) => ipcRenderer.invoke('git:save-patch', sitePath)
,
	startWpDebug: async (sitePath, onData) => {
		const handler = (_e, payload) => {
			if (payload.sitePath === sitePath) onData && onData(payload.data);
		};
		ipcRenderer.on('wp:debug-log:data', handler);
		await ipcRenderer.invoke('wp-debug:start', sitePath);
		return () => ipcRenderer.removeListener('wp:debug-log:data', handler);
	},
	stopWpDebug: async (sitePath) => {
		await ipcRenderer.invoke('wp-debug:stop', sitePath);
	}
,
	startServer: async (sitePath, onLog, onUrl, onStopped) => {
		const logHandler = (_e, payload) => {
			if (payload.sitePath === sitePath) onLog && onLog(payload);
		};
		const urlHandler = (_e, payload) => {
			if (payload.sitePath === sitePath) onUrl && onUrl(payload.url);
		};
		const stoppedHandler = (_e, payload) => {
			if (payload.sitePath === sitePath) {
				ipcRenderer.removeListener('playground:log', logHandler);
				ipcRenderer.removeListener('playground:url', urlHandler);
				ipcRenderer.removeListener('playground:stopped', stoppedHandler);
				onStopped && onStopped();
			}
		};
		ipcRenderer.on('playground:log', logHandler);
		ipcRenderer.on('playground:url', urlHandler);
		ipcRenderer.on('playground:stopped', stoppedHandler);

		// Invoke AFTER listeners are attached so early logs/URL are captured
		return await ipcRenderer.invoke('playground:start', sitePath);
	},
	stopServer: async (sitePath) => {
		return await ipcRenderer.invoke('playground:stop', sitePath);
	}
,
	// Global Playground web server controls
	playgroundWebAvailable: async () => {
		return await ipcRenderer.invoke('playground-web:available');
	}
,
	startPlaygroundWeb: async (onLog, onUrl, onStopped) => {
		const logHandler = (_e, payload) => { onLog && onLog(payload); };
		const urlHandler = (_e, payload) => { onUrl && onUrl(payload.url); };
		const stoppedHandler = (_e, payload) => {
			ipcRenderer.removeListener('playground-web:log', logHandler);
			ipcRenderer.removeListener('playground-web:url', urlHandler);
			ipcRenderer.removeListener('playground-web:stopped', stoppedHandler);
			onStopped && onStopped(payload);
		};
		ipcRenderer.on('playground-web:log', logHandler);
		ipcRenderer.on('playground-web:url', urlHandler);
		ipcRenderer.on('playground-web:stopped', stoppedHandler);
		return await ipcRenderer.invoke('playground-web:start');
	},
	stopPlaygroundWeb: async () => {
		return await ipcRenderer.invoke('playground-web:stop');
	}
,
	getSiteStatus: async (sitePath) => {
		return await ipcRenderer.invoke('site:status', sitePath);
	}
,
	setSkipInitWizard: async (sitePath, skip) => {
		return await ipcRenderer.invoke('sites:set-skip-init', sitePath, skip);
	}
,
	// SMTP bridge
	getEmails: async (sitePath) => {
		return await ipcRenderer.invoke('smtp:get', sitePath);
	}
,
	clearEmails: async (sitePath) => {
		return await ipcRenderer.invoke('smtp:clear', sitePath);
	}
,
	startSmtp: async (sitePath) => {
		return await ipcRenderer.invoke('smtp:start', sitePath);
	}
,
	stopSmtp: async (sitePath) => {
		return await ipcRenderer.invoke('smtp:stop', sitePath);
	}
,
	onNewEmail: (sitePath, handler) => {
		const h = (_e, payload) => { if (payload.sitePath === sitePath) handler && handler(payload.message); };
		ipcRenderer.on('smtp:new-email', h);
		return () => ipcRenderer.removeListener('smtp:new-email', h);
	}
,
	onSmtpStarted: (sitePath, handler) => {
		const h = (_e, payload) => { if (payload.sitePath === sitePath) handler && handler(payload.port); };
		ipcRenderer.on('smtp:started', h);
		return () => ipcRenderer.removeListener('smtp:started', h);
	}
});

