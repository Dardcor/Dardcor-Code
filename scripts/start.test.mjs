import assert from 'node:assert/strict';
import test from 'node:test';
import { getStartCommand } from './start.mjs';

test('selects the native launcher for Windows', () => {
	assert.deepEqual(getStartCommand('win32'), { command: 'scripts\\code.bat', shell: true });
});

test('selects the shell launcher for Linux', () => {
	assert.deepEqual(getStartCommand('linux'), { command: './scripts/code.sh', shell: false });
});
