/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { defineConfig } = require('@vscode/test-cli');







const extensions = [
	{
		label: 'markdown-language-features',
		workspaceFolder: `extensions/markdown-language-features/test-workspace`,
		mocha: { timeout: 60_000 }
	},
	{
		label: 'ipynb',
		workspaceFolder: path.join(os.tmpdir(), `ipynb-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'notebook-renderers',
		workspaceFolder: path.join(os.tmpdir(), `nbout-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'terminal-suggest',
		workspaceFolder: path.join(os.tmpdir(), `terminal-suggest-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'configuration-editing',
		workspaceFolder: path.join(os.tmpdir(), `confeditout-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'dardcor-api-tests-folder',
		extensionDevelopmentPath: `extensions/dardcor-api-tests`,
		workspaceFolder: `extensions/dardcor-api-tests/testWorkspace`,
		mocha: { timeout: 60_000 },
		files: 'extensions/dardcor-api-tests/out/singlefolder-tests/**/*.test.js',
	},
	{
		label: 'dardcor-api-tests-workspace',
		extensionDevelopmentPath: `extensions/dardcor-api-tests`,
		workspaceFolder: `extensions/dardcor-api-tests/testworkspace.dardcor-workspace`,
		mocha: { timeout: 60_000 },
		files: 'extensions/dardcor-api-tests/out/workspace-tests/**/*.test.js',
	},
	{
		label: 'git-base',
		mocha: { timeout: 60_000 }
	},
	{
		label: 'dardcor',
		files: 'extensions/dardcor/dist/test-extension.js',
		mocha: { ui: 'tdd', timeout: 60_000 }
	}
];


const defaultLaunchArgs = process.env.API_TESTS_EXTRA_ARGS?.split(' ') || [
	'--disable-telemetry', '--disable-experiments', '--skip-welcome', '--skip-release-notes', `--crash-reporter-directory=${__dirname}/.build/crashes`, `--logsPath=${__dirname}/.build/logs/integration-tests`, '--no-cached-data', '--disable-updates', '--use-inmemory-secretstorage', '--disable-extensions', '--disable-workspace-trust'
];

const config = defineConfig(extensions.map(extension => {

	const config = {
		platform: 'desktop',
		files: `extensions/${extension.label}/out/**/*.test.js`,
		extensionDevelopmentPath: `extensions/${extension.label}`,
		...extension,
	};

	config.mocha ??= {};
	if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || process.env.GITHUB_WORKSPACE) {
		let suite = '';
		if (process.env.VSCODE_BROWSER) {
			suite = `${process.env.VSCODE_BROWSER} Browser Integration ${config.label} tests`;
		} else if (process.env.REMOTE_VSCODE) {
			suite = `Remote Integration ${config.label} tests`;
		} else {
			suite = `Integration ${config.label} tests`;
		}

		config.mocha.reporter = 'mocha-multi-reporters';
		config.mocha.reporterOptions = {
			reporterEnabled: 'spec, mocha-junit-reporter',
			mochaJunitReporterReporterOptions: {
				testsuitesTitle: `${suite} ${process.platform}`,
				mochaFile: path.join(
					process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || process.env.GITHUB_WORKSPACE || __dirname,
					`test-results/${process.platform}-${process.arch}-${suite.toLowerCase().replace(/[^\w]/g, '-')}-results.xml`
				)
			}
		};
	}

	if (!config.platform || config.platform === 'desktop') {
		config.launchArgs = defaultLaunchArgs;
		config.useInstallation = {
			fromPath: process.env.INTEGRATION_TEST_ELECTRON_PATH || `${__dirname}/scripts/dardcor.${process.platform === 'win32' ? 'bat' : 'sh'}`,
		};
		config.env = {
			...config.env,
			VSCODE_SKIP_PRELAUNCH: '1',
		};
	} else {
	}

	return config;
}));

export default config;
