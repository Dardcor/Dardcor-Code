/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../base/test/node/testUtils.js';

suite('server.main directory creation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should create nested directories with recursive option', function () {
		this.timeout(10000);
		const testDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'server-main-dirs');
		const nestedPath = join(testDir, 'parent', 'child', 'extensions');

		try {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}

			if (!fs.existsSync(nestedPath)) {
				fs.mkdirSync(nestedPath, { mode: 0o700, recursive: true });
			}

			assert.strictEqual(fs.existsSync(nestedPath), true, 'Nested directory should exist');
			assert.strictEqual(fs.existsSync(join(testDir, 'parent')), true, 'Parent directory should exist');
			assert.strictEqual(fs.existsSync(join(testDir, 'parent', 'child')), true, 'Child directory should exist');

			if (process.platform !== 'win32') {
				const stats = fs.statSync(nestedPath);
				const mode = stats.mode & 0o777;
				assert.strictEqual(mode, 0o700, 'Directory should have 0o700 permissions');
			}
		} finally {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		}
	});

	test('should not fail when parent directories do not exist', function () {
		this.timeout(10000);
		const testDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'server-main-nonexistent');
		const deeplyNestedPath = join(testDir, 'level1', 'level2', 'level3', 'extensions');

		try {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}

			assert.doesNotThrow(() => {
				if (!fs.existsSync(deeplyNestedPath)) {
					fs.mkdirSync(deeplyNestedPath, { mode: 0o700, recursive: true });
				}
			}, 'Should not throw when creating deeply nested directories');

			assert.strictEqual(fs.existsSync(deeplyNestedPath), true, 'Deeply nested directory should exist');
		} finally {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		}
	});

	test('should handle existing directories gracefully', function () {
		this.timeout(10000);
		const testDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'server-main-existing');
		const extensionsPath = join(testDir, 'extensions');

		try {
			fs.mkdirSync(extensionsPath, { mode: 0o700, recursive: true });
			assert.strictEqual(fs.existsSync(extensionsPath), true);

			assert.doesNotThrow(() => {
				if (!fs.existsSync(extensionsPath)) {
					fs.mkdirSync(extensionsPath, { mode: 0o700, recursive: true });
				}
			}, 'Should not throw when directory already exists');

			assert.strictEqual(fs.existsSync(extensionsPath), true);
		} finally {
			if (fs.existsSync(testDir)) {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		}
	});
});
