/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { runTests } from '@vscode/test-electron';

async function cleanupTestDirectory(dir: string): Promise<void> {
	try {
		await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	} catch (error) {
		console.warn(`Failed to clean up temporary test directory ${dir}`, error);
	}
}

async function main() {
	const tempdir = await fs.mkdtemp(os.tmpdir() + '/dardcor-extension-test-');
	let workspaceFolder: string | undefined;

	let exitCode;
	try {
		const extensionDevelopmentPath = path.resolve(__dirname, '../..');

		const extensionTestsPath = path.resolve(__dirname, './run');

		const launchArgs = [];
		launchArgs.push('--disable-extensions');

		launchArgs.push('--user-data-dir', tempdir);

		const argv = await yargs(hideBin(process.argv))
			.options({
				stable: {
					type: 'boolean',
					default: false,
				},
				grep: {
					alias: 'g',
					type: 'string',
					default: '',
				},
			})
			.parse();
		const extensionTestsEnv: typeof process.env = {};
		if (argv.grep) { extensionTestsEnv.MOCHA_GREP = argv.grep; }
		if (argv._.length > 0) { extensionTestsEnv.MOCHA_FILES = argv._.join('\n'); }
		if (!process.stdout.isTTY) { extensionTestsEnv.NO_COLOR = 'true'; }
		workspaceFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'dardcor-extension-test-'));
		launchArgs.push(workspaceFolder);

		extensionTestsEnv.CORETEST = 'true';
		extensionTestsEnv.VITEST = 'true';
		extensionTestsEnv.TSX_TSCONFIG_PATH = path.resolve(__dirname, '../../../../../../tsconfig.json');

		const testOptions: Parameters<typeof runTests>[0] = {
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs,
			extensionTestsEnv,
		};

		if (process.env.VSCODE_UNDER_TEST) {
			testOptions.vscodeExecutablePath = process.env.VSCODE_UNDER_TEST;
		} else {
			testOptions.version = argv.stable ? 'stable' : 'insiders';
		}

		exitCode = await runTests(testOptions);
	} catch (err) {
		console.error('Failed to run tests', err);
		exitCode = 1;
	} finally {
		await Promise.all([
			cleanupTestDirectory(tempdir),
			workspaceFolder ? cleanupTestDirectory(workspaceFolder) : Promise.resolve(),
		]);
	}
	process.exit(exitCode);
}

void main();
