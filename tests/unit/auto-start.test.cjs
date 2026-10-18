'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { autoStartPlan } = require('../../src/renderer/auto-start.cjs');

const OFF = { autoStartServer: false, autoStartWatch: false };
const nothing = { consumeOpen: false, consumeResume: false, server: false, watch: false };

test('a row that became the open one consumes that edge and asks for what the settings say', () => {
	assert.deepEqual(autoStartPlan({ open: true, isActive: true, resumed: true, resume: null, settings: { autoStartServer: true, autoStartWatch: false } }), { consumeOpen: true, consumeResume: false, server: true, watch: false });
	assert.deepEqual(autoStartPlan({ open: true, isActive: true, resumed: true, resume: null, settings: { autoStartServer: false, autoStartWatch: true } }), { consumeOpen: true, consumeResume: false, server: false, watch: true });
	assert.deepEqual(autoStartPlan({ open: true, isActive: true, resumed: true, resume: null, settings: OFF }), { consumeOpen: true, consumeResume: false, server: false, watch: false });
});

test('the open edge is not consumed by a row that is not the open one, nor twice', () => {
	assert.deepEqual(autoStartPlan({ open: true, isActive: false, resumed: true, resume: null, settings: { autoStartServer: true, autoStartWatch: true } }), nothing);
	assert.deepEqual(autoStartPlan({ open: false, isActive: true, resumed: true, resume: null, settings: { autoStartServer: true, autoStartWatch: true } }), nothing);
});

test('the list the quit left is acted on once, for the open row and the others alike, whatever the settings say', () => {
	assert.deepEqual(autoStartPlan({ open: false, isActive: false, resumed: false, resume: { server: true, watch: false }, settings: OFF }), { consumeOpen: false, consumeResume: true, server: true, watch: false });
	assert.deepEqual(autoStartPlan({ open: false, isActive: false, resumed: false, resume: { server: false, watch: true }, settings: OFF }), { consumeOpen: false, consumeResume: true, server: false, watch: true });
	assert.deepEqual(autoStartPlan({ open: false, isActive: false, resumed: false, resume: { server: true, watch: true }, settings: OFF }), { consumeOpen: false, consumeResume: true, server: true, watch: true });
	assert.deepEqual(autoStartPlan({ open: false, isActive: false, resumed: true, resume: { server: true, watch: true }, settings: OFF }), nothing);
	assert.deepEqual(autoStartPlan({ open: false, isActive: false, resumed: false, resume: null, settings: OFF }), nothing);
});

test('both edges at once ask for the union of what each wants', () => {
	assert.deepEqual(autoStartPlan({ open: true, isActive: true, resumed: false, resume: { server: false, watch: true }, settings: { autoStartServer: true, autoStartWatch: false } }), { consumeOpen: true, consumeResume: true, server: true, watch: true });
});
