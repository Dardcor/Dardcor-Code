/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { gulp, rename, replace, filter, jsonEditor } from './lib/gulp/facade.ts';
import * as fs from 'fs';
import * as path from 'path';
import es from 'event-stream';
import vfs from 'vinyl-fs';
import electron from '@vscode/gulp-electron';
import * as util from './lib/util.ts';
import { getVersion } from './lib/getVersion.ts';
import { readISODate, writeISODate } from './lib/date.ts';
import * as task from './lib/gulp/task.ts';
import buildfile from './buildfile.ts';
import * as optimize from './lib/optimize.ts';
import { inlineMeta } from './lib/inlineMeta.ts';
import packageJson from '../package.json' with { type: 'json' };
import product from '../product.json' with { type: 'json' };
import * as crypto from 'crypto';
import * as cp from 'child_process';
import * as i18n from './lib/i18n.ts';
import { getProductionDependencies } from './lib/dependencies.ts';
import { config } from './lib/electron.ts';
import { createAsar } from './lib/asar.ts';
import minimist from 'minimist';
import { compileBuildWithoutManglingTask, compileBuildWithManglingTask } from './gulpfile.compile.ts';
import { compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileAllExtensionsBuildTask, compileExtensionMediaBuildTask, cleanExtensionsBuildTask } from './gulpfile.extensions.ts';
import { copyCodiconsTask } from './lib/compilation.ts';
import { getMxcExcludeFilter, getRipgrepExcludeFilter } from './lib/nativePackageFilters.ts';
import { ensureOSProxyResolverPlatformPackage, getOSProxyResolverExcludeFilter, getOSProxyResolverPlatformFiles } from './lib/osProxyResolver.ts';
import { readAgentSdkResults } from './agent-sdk/common.ts';
import { readDictationRuntimeResults } from './dictation-runtime/common.ts';
import { useEsbuildTranspile } from './buildConfig.ts';
import { promisify } from 'util';
import globCallback from 'glob';
import rceditCallback from 'rcedit';
import { spawnTsgo } from './lib/tsgo.ts';
import { runEsbuildTranspile, runEsbuildBundle } from './lib/esbuild.ts';


const glob = promisify(globCallback);
const rcedit = promisify(rceditCallback);
const root = path.dirname(import.meta.dirname);
const commit = getVersion(root);

const vscodeEntryPoints = [
	buildfile.workerEditor,
	buildfile.workerExtensionHost,
	buildfile.workerNotebook,
	buildfile.workerLanguageDetection,
	buildfile.workerLocalFileSearch,
	buildfile.workerProfileAnalysis,
	buildfile.workerOutputLinks,
	buildfile.workerBackgroundTokenization,
	buildfile.workbenchDesktop,
	buildfile.code
].flat();

const vscodeResourceIncludes = [

	'out-build/nls.messages.json',
	'out-build/nls.keys.json',

	'out-build/dc/code/electron-browser/workbench/workbench.html',

	'out-build/dc/base/parts/sandbox/electron-browser/preload.js',
	'out-build/dc/base/parts/sandbox/electron-browser/preload-aux.js',
	'out-build/dc/platform/browserView/electron-browser/preload-browserView.js',

	'out-build/dc/base/node/{terminateProcess.sh,cpuUsage.sh,ps.sh}',

	'out-build/dc/workbench/browser/parts/editor/media/*.png',
	'out-build/dc/workbench/contrib/debug/browser/media/*.png',

	'out-build/dc/workbench/contrib/externalTerminal/**/*.scpt',

	'out-build/dc/workbench/contrib/terminal/common/scripts/*.fish',
	'out-build/dc/workbench/contrib/terminal/common/scripts/*.ps1',
	'out-build/dc/workbench/contrib/terminal/common/scripts/*.psm1',
	'out-build/dc/workbench/contrib/terminal/common/scripts/*.sh',
	'out-build/dc/workbench/contrib/terminal/common/scripts/*.zsh',
	'out-build/dc/workbench/contrib/terminal/common/scripts/psreadline/**',

	'out-build/dc/platform/accessibilitySignal/browser/media/*.mp3',
	'out-build/dc/workbench/contrib/agentsVoice/browser/media/*.mp3',

	'out-build/dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.{svg,png}',
	'out-build/dc/workbench/contrib/welcomeOnboarding/browser/media/*.svg',

	'out-build/dc/workbench/contrib/chat/browser/widget/media/chatPet/*.{gif,png}',

	'out-build/dc/workbench/contrib/extensions/browser/media/{theme-icon.png,language-icon.svg}',
	'out-build/dc/workbench/services/extensionManagement/common/media/*.{svg,png}',

	'out-build/dc/workbench/contrib/webview/browser/pre/*.{js,html}',

	'out-build/dc/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',

	'out-build/dc/editor/common/languages/highlights/*.scm',

	'out-build/dc/editor/common/languages/injections/*.scm'
];

const vscodeResources = [

	...vscodeResourceIncludes,

	'!out-build/dc/code/browser/**',
	'!out-build/dc/editor/standalone/**',
	'!out-build/dc/code/**/*-dev.html',
	'!out-build/dc/workbench/contrib/issue/**/*-dev.html',
	'!**/test/**'
];

const bootstrapEntryPoints = [
	'out-build/main.js',
	'out-build/cli.js',
	'out-build/bootstrap-fork.js'
];

const bundleVSCodeTask = task.define('bundle-vscode', task.series(
	util.rimraf('out-dardcor-code'),
	optimize.bundleTask(
		{
			out: 'out-dardcor-code',
			esm: {
				src: 'out-build',
				entryPoints: [
					...vscodeEntryPoints,
					...bootstrapEntryPoints
				],
				resources: vscodeResources,
				skipTSBoilerplateRemoval: entryPoint => entryPoint === 'dc/code/electron-browser/workbench/workbench'
			}
		}
	)
));
task.task(bundleVSCodeTask);

const sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;
const isCI = !!process.env['CI'] || !!process.env['BUILD_ARTIFACTSTAGINGDIRECTORY'] || !!process.env['GITHUB_WORKSPACE'];
const useCdnSourceMapsForPackagingTasks = isCI;
const stripSourceMapsInPackagingTasks = process.env['VSCODE_KEEP_SOURCEMAPS'] === 'true' ? false : true;
const minifyDardcorTask = task.define('minify-dardcor', task.series(
	bundleVSCodeTask,
	util.rimraf('out-dardcor-code-min'),
	optimize.minifyTask('out-dardcor-code', `${sourceMappingURLBase}/core`)
));
task.task(minifyDardcorTask);
task.task(task.define('minify-vscode', minifyDardcorTask));
const minifyVSCodeTask = minifyDardcorTask;

task.task(task.define('core-ci-old', task.series(
	task.task('compile-build-with-mangling') as task.Task,
	task.parallel(
		task.task('minify-vscode') as task.Task,
		task.task('minify-vscode-reh') as task.Task,
		task.task('minify-vscode-reh-web') as task.Task,
	)
)));

task.task(task.define('core-ci', task.series(
	copyCodiconsTask,
	compileNonNativeExtensionsBuildTask,
	compileExtensionMediaBuildTask,
	writeISODate('out-build'),
	task.define('tsgo-typecheck', () => spawnTsgo(path.join(root, 'src', 'tsconfig.json'), { taskName: 'tsgo-typecheck', noEmit: true })),
	task.define('esbuild-out-build', () => runEsbuildTranspile('out-build', false)),
	task.parallel(
		task.define('esbuild-vscode-min', () => runEsbuildBundle('out-dardcor-code-min', true, true, 'desktop', `${sourceMappingURLBase}/core`)),
		task.define('esbuild-vscode-reh-min', () => runEsbuildBundle('out-dardcor-code-reh-min', true, true, 'server', `${sourceMappingURLBase}/core`)),
		task.define('esbuild-vscode-reh-web-min', () => runEsbuildBundle('out-dardcor-code-reh-web-min', true, true, 'server-web', `${sourceMappingURLBase}/core`)),
	)
)));

function computeChecksums(out: string, filenames: string[]): Record<string, string> {
	const result: Record<string, string> = {};
	filenames.forEach(function (filename) {
		const fullPath = path.join(root, out, filename);
		if (fs.existsSync(fullPath)) {
			result[filename] = computeChecksum(fullPath);
		}
	});
	return result;
}

function computeChecksum(filename: string): string {
	const contents = fs.readFileSync(filename);

	const hash = crypto
		.createHash('sha256')
		.update(contents)
		.digest('base64')
		.replace(/=+$/, '');

	return hash;
}

function getFoundryLocalExcludeFilter(): string[] {
	return [
		'**',
		'!**/foundry-local-sdk/prebuilds/**',
		'!**/foundry-local-sdk/foundry-local-core/**',
	];
}

function packageTask(platform: string, arch: string, sourceFolderName: string, destinationFolderName: string, _opts?: { stats?: boolean }) {
	const destination = path.join(path.dirname(root), destinationFolderName);
	platform = platform || process.platform;

	const task = () => {
		const out = sourceFolderName;
		const versionedResourcesFolder = util.getVersionedResourcesFolder(platform, commit!);

		const checksums = computeChecksums(out, [
			'dc/base/parts/sandbox/electron-browser/preload.js',
			'dc/workbench/workbench.desktop.main.js',
			'dc/workbench/workbench.desktop.main.css',
			'dc/workbench/api/node/extensionHostProcess.js',
			'dc/code/electron-browser/workbench/workbench.html',
			'dc/code/electron-browser/workbench/workbench.js',
		]);

		const src = gulp.src(out + '/**', { cwd: root, base: root })
			.pipe(rename(function (path) { path.dirname = path.dirname!.replace(new RegExp('^' + out), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']));

		const platformSpecificBuiltInExtensionsExclusions = product.builtInExtensions.filter(ext => {
			if (!(ext as { platforms?: string[] }).platforms) {
				return false;
			}

			const set = new Set((ext as { platforms?: string[] }).platforms);
			return !set.has(platform);
		}).map(ext => `!.build/extensions/${ext.name}/**`);

		const unusedExtensionsExclusions = [
			'!.build/extensions/clojure/**',
			'!.build/extensions/coffeescript/**',
			'!.build/extensions/fsharp/**',
			'!.build/extensions/groovy/**',
			'!.build/extensions/hlsl/**',
			'!.build/extensions/julia/**',
			'!.build/extensions/latex/**',
			'!.build/extensions/perl/**',
			'!.build/extensions/r/**',
			'!.build/extensions/razor/**',
			'!.build/extensions/restructuredtext/**',
			'!.build/extensions/shaderlab/**',
			'!.build/extensions/swift/**',
			'!.build/extensions/vb/**',
			'!.build/extensions/grunt/**',
			'!.build/extensions/gulp/**',
			'!.build/extensions/jake/**',
			'!.build/extensions/vscode-api-tests/**',
			'!.build/extensions/vscode-colorize-tests/**',
			'!.build/extensions/vscode-colorize-perf-tests/**',
			'!.build/extensions/vscode-test-resolver/**',
			'!.build/extensions/theme-abyss/**',
			'!.build/extensions/theme-kimbie-dark/**',
			'!.build/extensions/theme-monokai-dimmed/**',
			'!.build/extensions/theme-quietlight/**',
			'!.build/extensions/theme-red/**',
			'!.build/extensions/theme-solarized-dark/**',
			'!.build/extensions/theme-solarized-light/**',
			'!.build/extensions/theme-tomorrow-night-blue/**',
		];

		const extensions = gulp.src(['.build/extensions/**', ...platformSpecificBuiltInExtensionsExclusions, ...unusedExtensionsExclusions], { cwd: root, base: path.join(root, '.build'), dot: true });

		const sourceFilterPattern = [
			'**',
			'!**/*.tsbuildinfo',
			'!**/*.{js,css}.map',
			'!**/extensions/**/src/**',
			'!**/extensions/**/{test,tests}/**',
		];
		const sources = es.merge(src, extensions)
			.pipe(filter(sourceFilterPattern, { dot: true }));

		let version = packageJson.version;
		const quality = (product as { quality?: string }).quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;
		const packageJsonUpdates: Record<string, unknown> = { name, version };

		if (platform === 'linux') {
			packageJsonUpdates.desktopName = `${product.applicationName}.desktop`;
		}

		let packageJsonContents: string;
		const packageJsonStream = gulp.src(['package.json'], { cwd: root, base: root })
			.pipe(jsonEditor(packageJsonUpdates))
			.pipe(es.through(function (file) {
				packageJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		let productJsonContents: string;
		const productJsonStream = gulp.src(['product.json'], { cwd: root, base: root })
			.pipe(jsonEditor((json: Record<string, unknown>) => {
				json.commit = commit;
				json.date = readISODate(out);
				json.checksums = checksums;
				json.version = version;
				const agentSdks = readAgentSdkResults();
				if (Object.keys(agentSdks).length > 0) {
					json.agentSdks = agentSdks;
				}
				const dictationRuntime = readDictationRuntimeResults();
				if (dictationRuntime) {
					json.dictationRuntime = dictationRuntime;
				}
				return json;
			}))
			.pipe(es.through(function (file) {
				productJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		const license = gulp.src([product.licenseFileName, 'ThirdPartyNotices.txt', 'licenses/**'], { cwd: root, base: root, allowEmpty: true });

		const api = gulp.src('src/dardcor-dts/dardcor.d.ts', { cwd: root }).pipe(rename('out/dardcor-dts/dardcor.d.ts'));

		const telemetry = gulp.src('.build/telemetry/**', { cwd: root, base: path.join(root, '.build/telemetry'), dot: true, allowEmpty: true });

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));
		const productionDependencies = getProductionDependencies(root);
		const dependenciesSrc = productionDependencies.map(d => path.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat().concat('!**/*.mk');

		const depFilterPattern = [
			'**',
			`!**/${config.version}/**`,
			'!**/bin/darwin-arm64-87/**',
			'!**/package-lock.json',
			'!**/yarn.lock',
			'!**/@microsoft/mxc-sdk/**',
			'!**/node_modules/playwright-core/**'
		];
		if (stripSourceMapsInPackagingTasks) {
			depFilterPattern.push('!**/*.{js,css}.map');
		}

		const cleanedDeps = gulp.src(dependenciesSrc, { base: '.', dot: true })
			.pipe(filter(depFilterPattern))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, '.moduleignore')))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, `.moduleignore.${process.platform}`)));
		ensureOSProxyResolverPlatformPackage(platform, arch);
		const osProxyResolverPlatformPackage = gulp.src(getOSProxyResolverPlatformFiles(platform, arch), { base: '.', dot: true, allowEmpty: true });
		const deps = es.merge(cleanedDeps, osProxyResolverPlatformPackage)
			.pipe(filter(getRipgrepExcludeFilter(platform, arch)))
			.pipe(filter(getMxcExcludeFilter(arch)))
			.pipe(filter(getFoundryLocalExcludeFilter()))
			.pipe(filter(getOSProxyResolverExcludeFilter(platform, arch)))
			.pipe(jsFilter)
			.pipe(util.rewriteSourceMappingURL(sourceMappingURLBase))
			.pipe(jsFilter.restore)
			.pipe(createAsar(path.join(process.cwd(), 'node_modules'), [
				'**/*.node',
				'**/package.json',
				'**/@vscode/ripgrep-universal/bin/**',
				'**/node-pty/build/Release/*',
				'**/node-pty/build/Release/conpty/*',
				'**/node-pty/prebuilds/**',
				'**/node-pty/lib/worker/conoutSocketWorker.js',
				'**/node-pty/lib/shared/conout.js',
				'**/node-pty/package.json',
				'**/*.wasm',
				'**/@vscode/vsce-sign/bin/*',
			], [
				'**/*.mk',
			], [
				'node_modules/vsda/**',
				'node_modules/@vscode/sandbox-runtime/**',
				'node_modules/@pondwader/socks5-server/**',
				'node_modules/shell-quote/**',
				'node_modules/zod/**'
			], 'node_modules.asar'));

		const mergeStreams = [
			packageJsonStream,
			productJsonStream,
			license,
			api,
			telemetry,
			sources,
			deps
		];
		let all = es.merge(...mergeStreams);

		if (platform === 'win32') {
			all = es.merge(all, gulp.src([
				'resources/win32/bower.ico',
				'resources/win32/c.ico',
				'public/dardcor-code.ico',
				'resources/win32/config.ico',
				'resources/win32/cpp.ico',
				'resources/win32/csharp.ico',
				'resources/win32/css.ico',
				'resources/win32/default.ico',
				'resources/win32/go.ico',
				'resources/win32/html.ico',
				'resources/win32/jade.ico',
				'resources/win32/java.ico',
				'resources/win32/javascript.ico',
				'resources/win32/json.ico',
				'resources/win32/less.ico',
				'resources/win32/markdown.ico',
				'resources/win32/php.ico',
				'resources/win32/powershell.ico',
				'resources/win32/python.ico',
				'resources/win32/react.ico',
				'resources/win32/ruby.ico',
				'resources/win32/sass.ico',
				'resources/win32/shell.ico',
				'resources/win32/sql.ico',
				'resources/win32/typescript.ico',
				'resources/win32/vue.ico',
				'resources/win32/xml.ico',
				'resources/win32/yaml.ico',
				'resources/win32/code_70x70.png',
				'resources/win32/code_150x150.png'
			], { cwd: root, base: root }));
		} else if (platform === 'linux') {
			const policyDest = gulp.src('.build/policies/linux/**', { cwd: root, base: path.join(root, '.build/policies/linux'), allowEmpty: true })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, gulp.src('public/dardcor-code.png', { cwd: root, base: root, allowEmpty: true }), policyDest);
		} else if (platform === 'darwin') {
			const shortcut = gulp.src('resources/darwin/bin/code.sh', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename('bin/code'));
			const dcShortcut = gulp.src('resources/darwin/bin/code.sh', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(replace('@@NAME@@', product.nameShort))
				.pipe(rename('bin/dc'));
			const policyDest = gulp.src('.build/policies/darwin/**', { cwd: root, base: path.join(root, '.build/policies/darwin'), allowEmpty: true })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`));
			all = es.merge(all, shortcut, dcShortcut, policyDest);
		}

		const electronConfig = {
			...config,
			platform,
			arch: arch === 'armhf' ? 'arm' : arch,
			ffmpegChromium: false
		};

		let result: NodeJS.ReadWriteStream = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions())
			.pipe(filter(['**', '!**/.github/**'], { dot: true }))
			.pipe(electron(electronConfig))
			.pipe(filter([
				'**',
				'!LICENSE',
				'!version',
				'!**/default_app.asar',
				'!**/locales/!(en-US|id).pak',
				'!**/LICENSES.chromium.html',
				...(platform === 'darwin' ? ['!**/Contents/Applications', '!**/Contents/Applications/**'] : []),
				...(platform === 'win32' ? ['!**/electron_proxy.exe'] : []),
			], { dot: true }));

		if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/completions/bash/code', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = product.applicationName; })));

			result = es.merge(result, gulp.src('resources/completions/bash/code', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = 'dc'; })));

			result = es.merge(result, gulp.src('resources/completions/zsh/_code', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = '_' + product.applicationName; })));

			result = es.merge(result, gulp.src('resources/completions/zsh/_code', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename(function (f) { f.basename = '_dc'; })));
		}

		if (platform === 'win32') {
			result = es.merge(result, gulp.src('resources/win32/bin/code.js', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true }));

			if (versionedResourcesFolder) {
				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.cmd', { cwd: root, base: path.join(root, 'resources/win32/versioned'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.cmd', { cwd: root, base: path.join(root, 'resources/win32/versioned'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(rename(function (f) { f.basename = 'dc'; })));

				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.sh', { cwd: root, base: path.join(root, 'resources/win32/versioned'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', quality!))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));

				result = es.merge(result, gulp.src('resources/win32/versioned/bin/code.sh', { cwd: root, base: path.join(root, 'resources/win32/versioned'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', quality!))
					.pipe(rename(function (f) { f.basename = 'dc'; f.extname = ''; })));
			} else {
				result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(rename(function (f) { f.basename = product.applicationName; })));

				result = es.merge(result, gulp.src('resources/win32/bin/code.cmd', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(rename(function (f) { f.basename = 'dc'; })));

				result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', String(quality)))
					.pipe(rename(function (f) { f.basename = product.applicationName; f.extname = ''; })));

				result = es.merge(result, gulp.src('resources/win32/bin/code.sh', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true })
					.pipe(replace('@@NAME@@', product.nameShort))
					.pipe(replace('@@PRODNAME@@', product.nameLong))
					.pipe(replace('@@VERSION@@', version))
					.pipe(replace('@@COMMIT@@', String(commit)))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(replace('@@SERVERDATAFOLDER@@', product.serverDataFolderName || '.vscode-remote'))
					.pipe(replace('@@QUALITY@@', String(quality)))
					.pipe(rename(function (f) { f.basename = 'dc'; f.extname = ''; })));
			}

			result = es.merge(result, gulp.src('resources/win32/VisualElementsManifest.xml', { cwd: root, base: path.join(root, 'resources/win32'), allowEmpty: true })
				.pipe(replace('@@VERSIONFOLDER@@', versionedResourcesFolder ? `${versionedResourcesFolder}\\` : ''))
				.pipe(rename(product.nameShort + '.VisualElementsManifest.xml')));

			result = es.merge(result, gulp.src('.build/policies/win32/**', { cwd: root, base: path.join(root, '.build/policies/win32'), allowEmpty: true })
				.pipe(rename(f => f.dirname = `policies/${f.dirname}`)));

			if (quality === 'stable' || quality === 'insider') {
				result = es.merge(result, gulp.src('.build/win32/appx/**', { cwd: root, base: path.join(root, '.build/win32'), allowEmpty: true }));
				const rawVersion = version.replace(/-\w+$/, '').split('.');
				const appxVersion = `${rawVersion[0]}.0.${rawVersion[1]}.${rawVersion[2]}`;
				result = es.merge(result, gulp.src('resources/win32/appx/AppxManifest.xml', { cwd: root, base: root, allowEmpty: true })
					.pipe(replace('@@AppxPackageName@@', product.win32AppUserModelId))
					.pipe(replace('@@AppxPackageVersion@@', appxVersion))
					.pipe(replace('@@AppxPackageDisplayName@@', product.nameLong))
					.pipe(replace('@@AppxPackageDescription@@', product.win32NameVersion))
					.pipe(replace('@@ApplicationIdShort@@', product.win32RegValueName))
					.pipe(replace('@@ApplicationExe@@', product.nameShort + '.exe'))
					.pipe(replace('@@FileExplorerContextMenuID@@', quality === 'stable' ? 'OpenWithCode' : 'OpenWithCodeInsiders'))
					.pipe(replace('@@FileExplorerContextMenuCLSID@@', (product as { win32ContextMenu?: Record<string, { clsid: string }> }).win32ContextMenu?.[arch]?.clsid ?? ''))
					.pipe(replace('@@FileExplorerContextMenuDLL@@', `${quality === 'stable' ? 'code' : 'code_insider'}_explorer_command_${arch}.dll`))
					.pipe(rename(f => f.dirname = `appx/manifest`)));
			}
		} else if (platform === 'linux') {
			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@PRODNAME@@', product.nameLong))
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename('bin/' + product.applicationName)));

			result = es.merge(result, gulp.src('resources/linux/bin/code.sh', { cwd: root, base: root, allowEmpty: true })
				.pipe(replace('@@PRODNAME@@', product.nameLong))
				.pipe(replace('@@APPNAME@@', product.applicationName))
				.pipe(rename('bin/dc')));
		}

		result = inlineMeta(result, {
			targetPaths: bootstrapEntryPoints,
			packageJsonFn: () => packageJsonContents,
			productJsonFn: () => productJsonContents
		});

		return result.pipe(vfs.dest(destination));
	};
	task.taskName = `package-${platform}-${arch}`;
	return task;
}

function hasAuthenticodeSignature(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const proc = cp.spawn('signtool.exe', ['verify', '/pa', filePath]);
			proc.on('error', () => resolve(false));
			proc.on('exit', code => resolve(code === 0));
		} catch {
			resolve(false);
		}
	});
}

async function stripAuthenticodeSignature(filePath: string): Promise<void> {
	if (!await hasAuthenticodeSignature(filePath)) {
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const proc = cp.spawn('signtool.exe', ['remove', '/s', filePath]);
		let out = '';
		proc.stdout?.on('data', chunk => out += chunk.toString());
		proc.stderr?.on('data', chunk => out += chunk.toString());
		proc.on('error', reject);
		proc.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				process.stderr.write(out);
				reject(new Error(`signtool remove /s failed for ${filePath} (exit ${code})`));
			}
		});
	});
}

function patchWin32DependenciesTask(destinationFolderName: string) {
	const cwd = path.join(path.dirname(root), destinationFolderName);

	return async () => {
		const versionedResourcesFolder = util.getVersionedResourcesFolder('win32', commit!);
		const deps = (await Promise.all([
			glob('**/*.node', { cwd, ignore: ['extensions/node_modules/@parcel/watcher/**', '**/*-linux/**', '**/*-darwin/**', '**/linux-x64/**', '**/linux-arm64/**', '**/darwin-x64/**', '**/darwin-arm64/**'] }),
			glob('**/rg.exe', { cwd }),
			glob('**/tgrep.exe', { cwd }),
			glob('**/*explorer_command*.dll', { cwd }),
		])).flatMap(o => o);
		const packageJson = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'package.json'), 'utf8'));
		const product = JSON.parse(await fs.promises.readFile(path.join(cwd, versionedResourcesFolder, 'resources', 'app', 'product.json'), 'utf8'));
		const baseVersion = packageJson.version.replace(/-.*$/, '');

		const patchPromises = deps.map<Promise<unknown>>(async dep => {
			const basename = path.basename(dep);
			const fullPath = path.join(cwd, dep);

			await stripAuthenticodeSignature(fullPath);
			await rcedit(fullPath, {
				'file-version': baseVersion,
				'version-string': {
					'CompanyName': 'Dardcor Corporation',
					'FileDescription': product.nameLong,
					'FileVersion': packageJson.version,
					'InternalName': basename,
					'LegalCopyright': 'Copyright (C) 2026 Microsoft. All rights reserved',
					'OriginalFilename': basename,
					'ProductName': product.nameLong,
					'ProductVersion': packageJson.version,
				}
			});
		});

		await Promise.all(patchPromises);
	};
}

function bundleDardcorRouterTask(platform: string, destinationFolderName: string) {
	const outputDir = path.join(path.dirname(root), destinationFolderName);

	return async () => {
		const versionedResourcesFolder = util.getVersionedResourcesFolder(platform, commit!);
		const appBase = platform === 'darwin'
			? path.join(outputDir, `${product.nameLong}.app`, 'Contents', 'Resources', 'app')
			: path.join(outputDir, versionedResourcesFolder, 'resources', 'app');

		const routerSrc = path.join(root, '.dardcor-router');
		const routerDest = path.join(appBase, '.dardcor-router');
		const standaloneSrc = path.join(routerSrc, '.next', 'standalone');

		if (!fs.existsSync(standaloneSrc) || !fs.existsSync(path.join(standaloneSrc, '.next', 'server', 'chunks'))) {
			cp.execSync('npm run build', { cwd: routerSrc, stdio: 'inherit' });
		}

		if (fs.existsSync(standaloneSrc)) {
			fs.rmSync(routerDest, { recursive: true, force: true });
			fs.mkdirSync(routerDest, { recursive: true });

			fs.cpSync(standaloneSrc, routerDest, { recursive: true, force: true });

			const origServerChunks = path.join(routerSrc, '.next', 'server', 'chunks');
			const destServerChunks = path.join(routerDest, '.next', 'server', 'chunks');
			if (fs.existsSync(origServerChunks)) {
				fs.mkdirSync(destServerChunks, { recursive: true });
				fs.cpSync(origServerChunks, destServerChunks, { recursive: true, force: true });
			}

			const origStatic = path.join(routerSrc, '.next', 'static');
			const destStatic = path.join(routerDest, '.next', 'static');
			if (fs.existsSync(origStatic)) {
				fs.mkdirSync(destStatic, { recursive: true });
				fs.cpSync(origStatic, destStatic, { recursive: true, force: true });
			}

			const origPublic = path.join(routerSrc, 'public');
			const destPublic = path.join(routerDest, 'public');
			if (fs.existsSync(origPublic)) {
				fs.mkdirSync(destPublic, { recursive: true });
				fs.cpSync(origPublic, destPublic, { recursive: true, force: true });
			}

			const customServer = path.join(routerSrc, 'custom-server.js');
			if (fs.existsSync(customServer)) {
				fs.copyFileSync(customServer, path.join(routerDest, 'custom-server.js'));
			}
			const packageJson = path.join(routerSrc, 'package.json');
			if (fs.existsSync(packageJson)) {
				fs.copyFileSync(packageJson, path.join(routerDest, 'package.json'));
			}

			const walkAndPrune = (dir: string) => {
				if (!fs.existsSync(dir)) return;
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						if (entry.name === '.git' || entry.name === 'test' || entry.name === 'tests' || entry.name === '@img' || entry.name === 'sharp' || entry.name === 'playwright') {
							fs.rmSync(fullPath, { recursive: true, force: true });
						} else {
							walkAndPrune(fullPath);
						}
					} else if (entry.isFile()) {
						if (entry.name.endsWith('.map') || entry.name.endsWith('.pdb') || entry.name.endsWith('.nft.json') || entry.name.endsWith('.body') || (entry.name.endsWith('.md') && entry.name !== 'README.md')) {
							fs.rmSync(fullPath, { force: true });
						}
					}
				}
			};
			walkAndPrune(routerDest);
		}
	};
}

function pruneNonTargetPrebuildsTask(platform: string, arch: string, destinationFolderName: string) {
	const outputDir = path.join(path.dirname(root), destinationFolderName);

	return async () => {
		const versionedResourcesFolder = util.getVersionedResourcesFolder(platform, commit!);
		const appBase = platform === 'darwin'
			? path.join(outputDir, `${product.nameLong}.app`, 'Contents', 'Resources', 'app')
			: path.join(outputDir, versionedResourcesFolder, 'resources', 'app');
		const unpackedDir = path.join(appBase, 'node_modules.asar.unpacked');

		if (!fs.existsSync(unpackedDir)) {
			return;
		}

		const findPrebuildsDirs = (dir: string): string[] => {
			const results: string[] = [];
			try {
				const entries = fs.readdirSync(dir, { withFileTypes: true });
				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						if (entry.name === 'prebuilds') {
							results.push(fullPath);
						} else {
							results.push(...findPrebuildsDirs(fullPath));
						}
					}
				}
			} catch { }
			return results;
		};

		const prebuildsDirs = findPrebuildsDirs(unpackedDir);
		for (const pbDir of prebuildsDirs) {
			try {
				const subDirs = fs.readdirSync(pbDir, { withFileTypes: true });
				for (const sub of subDirs) {
					if (sub.isDirectory()) {
						const subName = sub.name.toLowerCase();
						let isForeign = false;
						if (platform === 'linux') {
							if (subName.startsWith('win32') || subName.startsWith('darwin')) isForeign = true;
							if (arch === 'x64' && (subName.includes('arm64') || subName.includes('armhf') || subName.includes('arm') || subName.includes('ia32'))) isForeign = true;
							if (arch === 'arm64' && (subName.includes('x64') || subName.includes('x86') || subName.includes('ia32') || subName.includes('armhf'))) isForeign = true;
						} else if (platform === 'win32') {
							if (subName.startsWith('linux') || subName.startsWith('darwin')) isForeign = true;
							if (arch === 'x64' && (subName.includes('arm64') || subName.includes('ia32') || subName.includes('x86'))) isForeign = true;
							if (arch === 'arm64' && (subName.includes('x64') || subName.includes('ia32') || subName.includes('x86'))) isForeign = true;
						} else if (platform === 'darwin') {
							if (subName.startsWith('linux') || subName.startsWith('win32')) isForeign = true;
						}
						if (isForeign) {
							fs.rmSync(path.join(pbDir, sub.name), { recursive: true, force: true });
						}
					}
				}
			} catch { }
		}

		if (platform === 'win32') {
			const expectedMachine = arch === 'x64' ? 0x8664 : arch === 'arm64' ? 0xaa64 : undefined;
			if (expectedMachine === undefined) {
				throw new Error(`Unsupported Windows native module architecture: ${arch}`);
			}

			const pruneForeignNativeModules = (dir: string) => {
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					const fullPath = path.join(dir, entry.name);
					if (entry.isDirectory()) {
						pruneForeignNativeModules(fullPath);
						continue;
					}
					if (!entry.isFile() || !entry.name.endsWith('.node')) {
						continue;
					}

					const image = fs.readFileSync(fullPath);
					if (image.length < 2 || image.readUInt16LE(0) !== 0x5a4d) {
						fs.rmSync(fullPath, { force: true });
						continue;
					}

					if (image.length < 0x40) {
						throw new Error(`Invalid Windows native module: ${fullPath}`);
					}

					const peOffset = image.readUInt32LE(0x3c);
					if (peOffset < 0x40 || peOffset + 6 > image.length || image.readUInt32LE(peOffset) !== 0x00004550) {
						throw new Error(`Invalid Windows native module: ${fullPath}`);
					}

					if (image.readUInt16LE(peOffset + 4) !== expectedMachine) {
						fs.rmSync(fullPath, { force: true });
					}
				}
			};

			pruneForeignNativeModules(unpackedDir);
		}

		const pruneUselessFiles = (dir: string) => {
			if (!fs.existsSync(dir)) return;
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					pruneUselessFiles(fullPath);
				} else if (entry.isFile()) {
					if (entry.name.endsWith('.pdb') || entry.name.endsWith('.map')) {
						fs.rmSync(fullPath, { force: true });
					}
				}
			}
		};
		pruneUselessFiles(unpackedDir);

		const testArtifacts = [
			'cli.js',
			'sanity-test-extension.js',
			'simulationMain.js',
			'simulationWorkbench.js',
			'test-extension.js'
		];
		for (const artifact of testArtifacts) {
			const artifactPath = path.join(appBase, 'extensions', 'dardcor', 'dist', artifact);
			if (fs.existsSync(artifactPath)) {
				fs.rmSync(artifactPath, { force: true });
			}
		}
		const distSourcemaps = path.join(appBase, 'extensions', 'dardcor', 'dist-sourcemaps');
		if (fs.existsSync(distSourcemaps)) {
			fs.rmSync(distSourcemaps, { recursive: true, force: true });
		}
	};
}

const buildRoot = path.dirname(root);

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'x64' },
	{ platform: 'win32', arch: 'arm64' },
	{ platform: 'darwin', arch: 'x64', opts: { stats: true } },
	{ platform: 'darwin', arch: 'arm64', opts: { stats: true } },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'armhf' },
	{ platform: 'linux', arch: 'arm64' },
];
BUILD_TARGETS.forEach(buildTarget => {
	const dashed = (str: string) => (str ? `-${str}` : ``);
	const platform = buildTarget.platform;
	const arch = buildTarget.arch;
	const opts = buildTarget.opts;

	const [vscode, vscodeMin] = ['', 'min'].map(minified => {
		const sourceFolderName = `out-dardcor-code${dashed(minified)}`;
		const destinationFolderName = `Dardcor-Code${dashed(platform)}${dashed(arch)}`;

		const packageTasks: task.Task[] = [
			compileNativeExtensionsBuildTask,
			util.rimraf(path.join(buildRoot, destinationFolderName)),
			packageTask(platform, arch, sourceFolderName, destinationFolderName, opts),
			pruneNonTargetPrebuildsTask(platform, arch, destinationFolderName),
			bundleDardcorRouterTask(platform, destinationFolderName)
		];

		if (platform === 'win32') {
			packageTasks.push(patchWin32DependenciesTask(destinationFolderName));
		}

		const vscodeTaskCI = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, task.series(...packageTasks));
		task.task(vscodeTaskCI);
		task.task(task.define(`dardcor-code${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, vscodeTaskCI));

		let vscodeTask: task.Task;
		if (useEsbuildTranspile) {
			const esbuildBundleTask = task.define(
				`esbuild-bundle${dashed(platform)}${dashed(arch)}${dashed(minified)}`,
				() => runEsbuildBundle(
					sourceFolderName,
					!!minified,
					true,
					'desktop',
					minified && useCdnSourceMapsForPackagingTasks ? `${sourceMappingURLBase}/core` : undefined
				)
			);
			vscodeTask = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				copyCodiconsTask,
				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				writeISODate('out-build'),
				esbuildBundleTask,
				vscodeTaskCI
			));
		} else {
			vscodeTask = task.define(`vscode${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				minified ? compileBuildWithManglingTask : compileBuildWithoutManglingTask,
				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				minified ? minifyVSCodeTask : bundleVSCodeTask,
				vscodeTaskCI
			));
		}
		task.task(vscodeTask);
		task.task(task.define(`dardcor-code${dashed(platform)}${dashed(arch)}${dashed(minified)}`, vscodeTask));

		return vscodeTask;
	});

	if (process.platform === platform && process.arch === arch) {
		task.task(task.define('vscode', task.series(vscode)));
		task.task(task.define('vscode-min', task.series(vscodeMin)));
		task.task(task.define('dardcor-code', task.series(vscode)));
		task.task(task.define('dardcor-code-min', task.series(vscodeMin)));
	}
});


task.task(task.define(
	'vscode-translations-export',
	task.series(
		task.task('core-ci') as task.Task,
		compileAllExtensionsBuildTask,
		function () {
			const pathToMetadata = './out-build/nls.metadata.json';
			const pathToExtensions = '.build/extensions/*';
			const pathToSetup = 'build/win32/i18n/messages.en.isl';

			return es.merge(
				gulp.src(pathToMetadata).pipe(i18n.createXlfFilesForCoreBundle()),
				gulp.src(pathToSetup).pipe(i18n.createXlfFilesForIsl()),
				gulp.src(pathToExtensions).pipe(i18n.createXlfFilesForExtensions())
			).pipe(vfs.dest('../vscode-translations-export'));
		}
	)
));

task.task('vscode-translations-import', function () {
	const options = minimist(process.argv.slice(2), {
		string: 'location',
		default: {
			location: '../vscode-translations-import'
		}
	});
	return es.merge([...i18n.defaultLanguages, ...i18n.extraLanguages].map(language => {
		const id = language.id;
		return gulp.src(`${options.location}/${id}/vscode-setup/messages.xlf`)
			.pipe(i18n.prepareIslFiles(language))
			.pipe(vfs.dest(`./build/win32/i18n`));
	}));
});

