/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

import glob from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';
import { monacoTypecheckTask } from './gulpfile.editor.ts';
import { compileExtensionMediaTask, compileExtensionsTask, watchExtensionsTask } from './gulpfile.extensions.ts';
import * as compilation from './lib/compilation.ts';
import * as task from './lib/gulp/task.ts';
import * as util from './lib/util.ts';
import { runEsbuildTranspile } from './lib/esbuild.ts';

task.task(compilation.compileExtensionPointNamesTask);

const require = createRequire(import.meta.url);

task.task(compilation.compileApiProposalNamesTask);
task.task(compilation.watchApiProposalNamesTask);

task.task(task.define('transpile-client-esbuild', task.series(
	compilation.copyCodiconsTask,
	task.define('esbuild-out-build', () => runEsbuildTranspile('out', false)),
)));

const writeBuildDoneTask = task.define('write-build-done', async () => {
	const outDirPath = path.join(import.meta.dirname, '..', 'out');
	await fs.promises.mkdir(outDirPath, { recursive: true });
	await fs.promises.writeFile(
		path.join(outDirPath, '.build-done'),
		JSON.stringify({
			timestamp: new Date().toISOString(),
			status: 'complete',
			source: 'gulp'
		}, null, 2),
		'utf8'
	);
});

const transpileClientTask = task.define('transpile-client', task.series(util.rimraf('out'), compilation.transpileTask('src', 'out'), writeBuildDoneTask));
task.task(transpileClientTask);

const compileClientTask = task.define('compile-client', task.series(util.rimraf('out'), compilation.copyCodiconsTask, compilation.compileApiProposalNamesTask, compilation.compileExtensionPointNamesTask, compilation.compileTask('src', 'out', false), writeBuildDoneTask));
task.task(compileClientTask);

const watchClientTask = task.define('watch-client', task.parallel(compilation.watchTypeCheckTask('src'), compilation.watchApiProposalNamesTask, compilation.watchExtensionPointNamesTask, compilation.watchCodiconsTask));
task.task(watchClientTask);

const _compileTask = task.define('compile', task.parallel(monacoTypecheckTask, compileClientTask, compileExtensionsTask, compileExtensionMediaTask));
task.task(_compileTask);

task.task(task.define('watch', task.parallel( watchClientTask, watchExtensionsTask)));

task.task('default', _compileTask);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	process.exit(1);
});

glob.sync('gulpfile.*.ts', { cwd: import.meta.dirname })
	.forEach(f => {
		return require(`./${f}`);
	});
