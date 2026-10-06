'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sitesToResume, readResume } = require('../../src/resume-sites.cjs');

const CORE_WATCH = { script: 'grunt', args: ['--', '_watch'] };
const watchFor = () => CORE_WATCH;

test('the sites with a server are listed under the servers, once each', () => {
	assert.deepEqual(sitesToResume({ servers: ['/a', '/b', '/a'], scripts: [], watchFor }), { servers: ['/a', '/b'], watches: [] });
});

test('a site running its project\'s watch is listed under the watches, and a site running another script is not', () => {
	const scripts = [
		{ directoryPath: '/w', scriptName: 'grunt', scriptArgs: ['--', '_watch'] },
		{ directoryPath: '/b', scriptName: 'build', scriptArgs: [] },
		{ directoryPath: '/g', scriptName: 'grunt', scriptArgs: [] }
	];
	assert.deepEqual(sitesToResume({ servers: [], scripts, watchFor }), { servers: [], watches: ['/w'] });
});

test('a site with a server is not also listed under the watches', () => {
	const scripts = [{ directoryPath: '/a', scriptName: 'grunt', scriptArgs: ['--', '_watch'] }];
	assert.deepEqual(sitesToResume({ servers: ['/a'], scripts, watchFor }), { servers: ['/a'], watches: [] });
});

test('the watch is the project\'s own: a Gutenberg site\'s is npm run dev', () => {
	const scripts = [{ directoryPath: '/gb', scriptName: 'dev', scriptArgs: [] }, { directoryPath: '/core', scriptName: 'dev', scriptArgs: [] }];
	const byProject = (dir) => (dir === '/gb' ? { script: 'dev', args: [] } : CORE_WATCH);
	assert.deepEqual(sitesToResume({ servers: [], scripts, watchFor: byProject }), { servers: [], watches: ['/gb'] });
	assert.deepEqual(sitesToResume({ servers: [], scripts, watchFor: () => null }), { servers: [], watches: [] });
});

test('nothing running is nothing to start again', () => {
	assert.deepEqual(sitesToResume({ watchFor }), { servers: [], watches: [] });
});

test('the list is read back only while the quit setting says restart, and only its paths', () => {
	const list = { servers: ['/a', 42, ''], watches: ['/w'] };
	assert.deepEqual(readResume({ quitBehavior: 'restart', resume: list }), { servers: ['/a'], watches: ['/w'] });
	assert.deepEqual(readResume({ quitBehavior: 'stop', resume: list }), { servers: [], watches: [] });
	assert.deepEqual(readResume({ resume: list }), { servers: [], watches: [] });
	assert.deepEqual(readResume({ quitBehavior: 'restart' }), { servers: [], watches: [] });
	assert.deepEqual(readResume({ quitBehavior: 'restart', resume: 'servers' }), { servers: [], watches: [] });
	assert.deepEqual(readResume(undefined), { servers: [], watches: [] });
});
