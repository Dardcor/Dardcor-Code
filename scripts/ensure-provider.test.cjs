const assert = require('node:assert/strict');
const test = require('node:test');
const { getProviderLaunch } = require('./ensure-provider.js');

test('passes port 25128 when starting the Windows npm fallback', () => {
	const launch = getProviderLaunch(true, false);

	assert.equal(launch.command, 'npm.cmd');
	assert.deepEqual(launch.args, ['run', 'dev:webpack', '--', '--port', '25128']);
});
