/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { join } from '../../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { codexBinaryTriple, codexPackageSuffix, resolveCodexDevSdkRoot } from '../../../node/codex/codexAgent.js';

suite('codex package paths', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('codexPackageSuffix', () => {

		test('every supported (platform, arch) returns the npm optionalDependencies suffix', () => {
			assert.deepStrictEqual({
				'darwin-x64': codexPackageSuffix('darwin', 'x64'),
				'darwin-arm64': codexPackageSuffix('darwin', 'arm64'),
				'linux-x64': codexPackageSuffix('linux', 'x64'),
				'linux-arm64': codexPackageSuffix('linux', 'arm64'),
				'win32-x64': codexPackageSuffix('win32', 'x64'),
				'win32-arm64': codexPackageSuffix('win32', 'arm64'),
			}, {
				'darwin-x64': 'darwin-x64',
				'darwin-arm64': 'darwin-arm64',
				'linux-x64': 'linux-x64',
				'linux-arm64': 'linux-arm64',
				'win32-x64': 'win32-x64',
				'win32-arm64': 'win32-arm64',
			});
		});

		test('never returns a -musl suffix on Linux (Codex is statically musl-linked)', () => {
			assert.strictEqual(codexPackageSuffix('linux', 'x64'), 'linux-x64');
			assert.strictEqual(codexPackageSuffix('linux', 'arm64'), 'linux-arm64');
		});

		test('returns undefined for unsupported platforms and architectures', () => {
			assert.strictEqual(codexPackageSuffix('freebsd' as NodeJS.Platform, 'x64'), undefined);
			assert.strictEqual(codexPackageSuffix('aix' as NodeJS.Platform, 'arm64'), undefined);
			assert.strictEqual(codexPackageSuffix('darwin', 'ia32'), undefined);
			assert.strictEqual(codexPackageSuffix('linux', 'arm'), undefined);
			assert.strictEqual(codexPackageSuffix('win32', 'mips'), undefined);
		});
	});

	suite('codexBinaryTriple', () => {

		test('every suffix produced by codexPackageSuffix maps to a rust target triple', () => {
			assert.deepStrictEqual({
				'linux-x64': codexBinaryTriple('linux-x64'),
				'linux-arm64': codexBinaryTriple('linux-arm64'),
				'darwin-x64': codexBinaryTriple('darwin-x64'),
				'darwin-arm64': codexBinaryTriple('darwin-arm64'),
				'win32-x64': codexBinaryTriple('win32-x64'),
				'win32-arm64': codexBinaryTriple('win32-arm64'),
			}, {
				'linux-x64': 'x86_64-unknown-linux-musl',
				'linux-arm64': 'aarch64-unknown-linux-musl',
				'darwin-x64': 'x86_64-apple-darwin',
				'darwin-arm64': 'aarch64-apple-darwin',
				'win32-x64': 'x86_64-pc-windows-msvc',
				'win32-arm64': 'aarch64-pc-windows-msvc',
			});
		});

		test('returns undefined for unknown suffixes', () => {
			assert.strictEqual(codexBinaryTriple('linux-x64-musl'), undefined);
			assert.strictEqual(codexBinaryTriple('darwin-arm'), undefined);
			assert.strictEqual(codexBinaryTriple(''), undefined);
		});
	});

	suite('resolveCodexDevSdkRoot', () => {

		test('returns the directory containing node_modules when @openai/codex resolves', async () => {
			const root = join('home', 'me', 'vscode');
			const pkgJson = join(root, 'node_modules', '@openai', 'codex', 'package.json');
			assert.strictEqual(await resolveCodexDevSdkRoot(() => pkgJson), root);
		});

		test('returns undefined when resolution throws (e.g. built product without the devDependency)', async () => {
			assert.strictEqual(await resolveCodexDevSdkRoot(() => { throw new Error('Cannot find module'); }), undefined);
		});
	});
});
