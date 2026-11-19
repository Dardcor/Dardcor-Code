/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

process.env.MOCHA_COLORS = '1';

import * as assert from 'assert';
import Mocha from 'mocha';
import * as path from 'path';
import * as fs from 'fs';
import glob from 'glob';
import minimatch from 'minimatch';
import minimist from 'minimist';
import * as module from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import semver from 'semver';




const args = minimist(process.argv.slice(2), {
	boolean: ['build', 'coverage', 'help'],
	string: ['run', 'coveragePath', 'coverageFormats'],
	alias: {
		h: 'help'
	},
	default: {
		build: false,
		coverage: false,
		help: false
	},
	description: {
		build: 'Run from out-build',
		run: 'Run a single file',
		coverage: 'Generate a coverage report',
		coveragePath: 'Path to coverage report to generate',
		coverageFormats: 'Coverage formats to generate',
		help: 'Show help'
	}
});

if (args.help) {
	console.log(`Usage: node test/unit/node/index [options]

Options:
--build          Run from out-build
--run <file>     Run a single file
--coverage       Generate a coverage report
--help           Show help`);
	process.exit(0);
}

const TEST_GLOB = '**/test/**/*.test.js';

const excludeGlobs = [
	'**/{browser,electron-browser,electron-main,electron-utility}/**/*.test.js',
	'**/dc/platform/environment/test/node/nativeModules.test.js',
	'**/dc/base/parts/storage/test/node/storage.test.js',
	'**/dc/workbench/contrib/testing/test/**',
];

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const out = args.build ? 'out-build' : 'out';
const src = path.join(REPO_ROOT, out);
const baseUrl = pathToFileURL(src);

const remotePackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'remote', 'package.json'), 'utf8'));
const requiredNodeVersion = semver.parse(remotePackage.dardcorBuild?.nodeGyp?.target ?? remotePackage.config?.node_gyp_target ?? remotePackage.config?.target ?? '');
const currentNodeVersion = semver.parse(process.version);
if (!requiredNodeVersion) {
	throw new Error('The remote package must declare a valid node_gyp_target in package.json config.');
}
if (currentNodeVersion?.major < requiredNodeVersion?.major) {
	console.error(`node.js unit tests require a major node.js version of ${requiredNodeVersion?.major} (your version is: ${currentNodeVersion?.major})`);
	process.exit(1);
}

function main() {

	const _require = module.createRequire(import.meta.url);
	globalThis._VSCODE_PRODUCT_JSON = _require(`${REPO_ROOT}/product.json`);
	globalThis._VSCODE_PACKAGE_JSON = _require(`${REPO_ROOT}/package.json`);

	globalThis._VSCODE_FILE_ROOT = baseUrl.href;

	if (args.build) {
		globalThis._VSCODE_NLS_MESSAGES = _require(`${REPO_ROOT}/${out}/nls.messages.json`);
	}

	Object.assign(globalThis, {
		__readFileInTests: (/** @type {string} */ path) => fs.promises.readFile(path, 'utf-8'),
		__writeFileInTests: (/** @type {string} */ path, /** @type {BufferEncoding} */ contents) => fs.promises.writeFile(path, contents),
		__readDirInTests: (/** @type {string} */ path) => fs.promises.readdir(path),
		__unlinkInTests: (/** @type {string} */ path) => fs.promises.unlink(path),
		__mkdirPInTests: (/** @type {string} */ path) => fs.promises.mkdir(path, { recursive: true }),
	});

	const crashDir = path.join(REPO_ROOT, '.build', 'crashes');
	fs.mkdirSync(crashDir, { recursive: true });
	if (process.report) {
		process.report.directory = crashDir;
		process.report.reportOnFatalError = true;
		process.report.reportOnUncaughtException = true;
	}

	process.on('uncaughtException', function(e) {
		console.error(e.stack || e);
	});

	process.on('unhandledRejection', function(reason) {
		console.error('Unhandled promise rejection:');
		console.error(reason && (/** @type {Error} */ (reason)).stack || reason);
	});






	const loader = function(modules, onLoad, onError) {
		const loads = modules.map(mod => import(`${baseUrl}/${mod}.js`).catch(err => {
			console.error(`FAILED to load ${mod} as ${baseUrl}/${mod}.js`);
			throw err;
		}));
		Promise.all(loads).then(onLoad, onError);
	};


	let didErr = false;
	const write = process.stderr.write;
	process.stderr.write = function(...args) {
		didErr = didErr || !!args[0];
		return write.apply(process.stderr, args);
	};


	const runner = new Mocha({
		ui: 'tdd'
	});




	async function loadModules(modules) {
		for (const file of modules) {
			runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_PRE_REQUIRE, globalThis, file, runner);
			const m = await new Promise((resolve, reject) => loader([file], resolve, reject));
			runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_REQUIRE, m, file, runner);
			runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_POST_REQUIRE, globalThis, file, runner);
		}
	}


	let loadFunc = null;

	if (args.runGlob) {
		loadFunc = (cb) => {
			const doRun = /** @param tests */(tests) => {
				const modulesToLoad = tests.map(test => {
					if (path.isAbsolute(test)) {
						test = path.relative(src, path.resolve(test));
					}

					return test.replace(/(\.js)|(\.d\.ts)|(\.js\.map)$/, '');
				});
				loadModules(modulesToLoad).then(() => cb(null), cb);
			};

			glob(args.runGlob, { cwd: src }, function(err, files) { doRun(files); });
		};
	} else if (args.run) {
		const tests = (typeof args.run === 'string') ? [args.run] : args.run;
		const modulesToLoad = tests.map(function(test) {
			test = test.replace(/^src/, 'out');
			test = test.replace(/\.ts$/, '.js');
			return path.relative(src, path.resolve(test)).replace(/(\.js)|(\.js\.map)$/, '').replace(/\\/g, '/');
		});
		loadFunc = (cb) => {
			loadModules(modulesToLoad).then(() => cb(null), cb);
		};
	} else {
		loadFunc = (cb) => {
			glob(TEST_GLOB, { cwd: src }, function(err, files) {

				const modules = [];
				for (const file of files) {
					if (!excludeGlobs.some(excludeGlob => minimatch(file, excludeGlob))) {
						modules.push(file.replace(/\.js$/, ''));
					}
				}
				loadModules(modules).then(() => cb(null), cb);
			});
		};
	}

	loadFunc(function(err) {
		if (err) {
			console.error(err);
			return process.exit(1);
		}

		process.stderr.write = write;

		if (!args.run && !args.runGlob) {
			Mocha.suite('Loader', function() {
				test('should not explode while loading', function() {
					assert.ok(!didErr, `should not explode while loading: ${didErr}`);
				});
			});
		}

		const unexpectedErrors = [];
		Mocha.suite('Errors', function() {
			test('should not have unexpected errors in tests', function() {
				if (unexpectedErrors.length) {
					unexpectedErrors.forEach(function(stack) {
						console.error('');
						console.error(stack);
					});

					assert.ok(false);
				}
			});
		});

		import(`${baseUrl}/dc/base/common/errors.js`).then(errors => {
			errors.setUnexpectedErrorHandler(function(err) {
				const stack = (err && err.stack) || (new Error().stack);
				unexpectedErrors.push((err && err.message ? err.message : err) + '\n' + stack);
			});

			runner.run(failures => process.exit(failures ? 1 : 0));
		});
	});
}

main();
