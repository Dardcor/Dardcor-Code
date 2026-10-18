/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import glob from 'glob';
import gulpWatch from '../lib/watch/index.ts';
import { nlsPlugin, createNLSCollector, finalizeNLS, postProcessNLS } from './nls-plugin.ts';
import { convertPrivateFields, adjustSourceMap, type ConvertPrivateFieldsResult } from './private-to-property.ts';
import { getVersion } from '../lib/getVersion.ts';
import { getGitCommitDate } from '../lib/date.ts';
import product from '../../product.json' with { type: 'json' };
import packageJson from '../../package.json' with { type: 'json' };
import { useEsbuildTranspile } from '../buildConfig.ts';
import { isWebExtension, type IScannedBuiltinExtension } from '../lib/extensions.ts';

const globAsync = promisify(glob);


const REPO_ROOT = path.dirname(path.dirname(import.meta.dirname));
const commit = getVersion(REPO_ROOT);
const quality = (product as { quality?: string }).quality;
const version = (quality && quality !== 'stable') ? `${packageJson.version}-${quality}` : packageJson.version;

const command = process.argv[2];

function getArgValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index !== -1 && index + 1 < process.argv.length) {
		return process.argv[index + 1];
	}
	return undefined;
}

const options = {
	watch: process.argv.includes('--watch'),
	minify: process.argv.includes('--minify'),
	nls: process.argv.includes('--nls'),
	manglePrivates: process.argv.includes('--mangle-privates'),
	excludeTests: process.argv.includes('--exclude-tests'),
	out: getArgValue('--out'),
	target: getArgValue('--target') ?? 'desktop',
	sourceMapBaseUrl: getArgValue('--source-map-base-url'),
};

type BuildTarget = 'desktop' | 'server' | 'server-web' | 'web';

const SRC_DIR = 'src';
const OUT_DIR = 'out';
const OUT_VSCODE_DIR = 'out-dardcor-code';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);


const extensionHostEntryPoints = [
	'dc/workbench/api/node/extensionHostProcess',
	'dc/workbench/api/worker/extensionHostWorkerMain',
];

function isExtensionHostBundle(filePath: string): boolean {
	const normalized = filePath.replaceAll('\\', '/');
	return extensionHostEntryPoints.some(ep => normalized.endsWith(`${ep}.js`));
}

const workerEntryPoints = [
	'dc/editor/common/services/editorWebWorkerMain',
	'dc/workbench/api/worker/extensionHostWorkerMain',
	'dc/workbench/contrib/notebook/common/services/notebookWebWorkerMain',
	'dc/workbench/services/languageDetection/browser/languageDetectionWebWorkerMain',
	'dc/workbench/services/search/worker/localFileSearchMain',
	'dc/workbench/contrib/output/common/outputLinkComputerMain',
	'dc/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain',
];

const desktopWorkerEntryPoints = [
	'dc/platform/profiling/electron-browser/profileAnalysisWorkerMain',
];

const desktopEntryPoints = [
	'dc/workbench/workbench.desktop.main',
	'dc/workbench/contrib/debug/node/telemetryApp',
	'dc/platform/files/node/watcher/watcherMain',
	'dc/platform/localTranscription/node/localTranscriptionMain',
	'dc/platform/terminal/node/ptyHostMain',
	'dc/platform/agentHost/node/agentHostMain',
	'dc/platform/agentHost/node/diffWorkerMain',
	'dc/workbench/api/node/extensionHostProcess',
];

const codeEntryPoints = [
	'dc/code/node/cliProcessMain',
	'dc/code/electron-utility/sharedProcess/sharedProcessMain',
	'dc/code/electron-browser/workbench/workbench',
];

const webEntryPoints = [
	'dc/workbench/workbench.web.main.internal',
	'dc/code/browser/workbench/workbench',
];


const keyboardMapEntryPoints = [
	'dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.linux',
	'dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.darwin',
	'dc/workbench/services/keybinding/browser/keyboardLayouts/layout.contribution.win',
];

const serverEntryPoints = [
	'dc/workbench/api/node/extensionHostProcess',
	'dc/platform/files/node/watcher/watcherMain',
	'dc/platform/terminal/node/ptyHostMain',
	'dc/platform/agentHost/node/agentHostMain',
	'dc/platform/agentHost/node/diffWorkerMain',
];

const bootstrapEntryPointsDesktop = [
	'main',
	'cli',
	'bootstrap-fork',
];

const bootstrapEntryPointsServer = [
	'server-main',
	'server-cli',
	'bootstrap-fork',
];

function getEntryPointsForTarget(target: BuildTarget): string[] {
	switch (target) {
		case 'desktop':
			return [
				...workerEntryPoints,
				...desktopWorkerEntryPoints,
				...desktopEntryPoints,
				...codeEntryPoints,
			];
		case 'server':
			return [
				...serverEntryPoints,
			];
		case 'server-web':
			return [
				...serverEntryPoints,
				...workerEntryPoints,
				...webEntryPoints,
				...keyboardMapEntryPoints,
			];
		case 'web':
			return [
				...workerEntryPoints,
				'dc/workbench/workbench.web.main.internal',
				...keyboardMapEntryPoints,
			];
		default:
			throw new Error(`Unknown target: ${target}`);
	}
}

function getBootstrapEntryPointsForTarget(target: BuildTarget): string[] {
	switch (target) {
		case 'desktop':
			return bootstrapEntryPointsDesktop;
		case 'server':
		case 'server-web':
			return bootstrapEntryPointsServer;
		case 'web':
			return [];
		default:
			throw new Error(`Unknown target: ${target}`);
	}
}

function getCssBundleEntryPointsForTarget(target: BuildTarget): Set<string> {
	switch (target) {
		case 'desktop':
			return new Set([
				'dc/workbench/workbench.desktop.main',
				'dc/code/electron-browser/workbench/workbench',
			]);
		case 'server':
			return new Set();
		case 'server-web':
			return new Set([
				'dc/workbench/workbench.web.main.internal',
				'dc/code/browser/workbench/workbench',
			]);
		case 'web':
			return new Set([
				'dc/workbench/workbench.web.main.internal',
			]);
		default:
			throw new Error(`Unknown target: ${target}`);
	}
}


const commonResourcePatterns = [
	'dc/editor/common/languages/highlights/*.scm',
	'dc/editor/common/languages/injections/*.scm',

	'dc/workbench/browser/media/code-icon.svg',
	'dc/workbench/browser/parts/editor/media/letterpress*.svg',
	'dc/workbench/contrib/chat/browser/widget/media/chatPet/*.{gif,png}',
];

const desktopResourcePatterns = [
	...commonResourcePatterns,

	'dc/code/electron-browser/workbench/workbench.html',
	'dc/code/electron-browser/workbench/workbench-dev.html',
	'dc/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
	'dc/workbench/contrib/webview/browser/pre/*.html',

	'dc/workbench/contrib/webview/browser/pre/*.js',

	'dc/base/node/*.sh',
	'dc/workbench/contrib/terminal/common/scripts/*.sh',
	'dc/workbench/contrib/terminal/common/scripts/*.ps1',
	'dc/workbench/contrib/terminal/common/scripts/*.psm1',
	'dc/workbench/contrib/terminal/common/scripts/*.fish',
	'dc/workbench/contrib/terminal/common/scripts/*.zsh',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.psd1',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.psm1',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.dll',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.ps1xml',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/net6plus/*.dll',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/netstd/*.dll',
	'dc/workbench/contrib/externalTerminal/**/*.scpt',

	'dc/platform/accessibilitySignal/browser/media/*.mp3',
	'dc/workbench/contrib/agentsVoice/browser/media/*.mp3',

	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.svg',
	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.png',
	'dc/workbench/contrib/welcomeOnboarding/browser/media/*.svg',
	'dc/workbench/contrib/extensions/browser/media/{theme-icon.png,language-icon.svg}',
	'dc/workbench/services/extensionManagement/common/media/*.svg',
	'dc/workbench/services/extensionManagement/common/media/*.png',
	'dc/workbench/browser/parts/editor/media/*.png',
	'dc/workbench/contrib/debug/browser/media/*.png',
];

const serverResourcePatterns = [
	'dc/base/node/cpuUsage.sh',
	'dc/base/node/ps.sh',

	'dc/workbench/contrib/externalTerminal/**/*.scpt',

	'dc/workbench/contrib/terminal/common/scripts/shellIntegration.ps1',
	'dc/workbench/contrib/terminal/common/scripts/CodeTabExpansion.psm1',
	'dc/workbench/contrib/terminal/common/scripts/GitTabExpansion.psm1',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration-env.zsh',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration-profile.zsh',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration-login.zsh',
	'dc/workbench/contrib/terminal/common/scripts/shellIntegration.fish',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.psd1',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.psm1',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.dll',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/*.ps1xml',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/net6plus/*.dll',
	'dc/workbench/contrib/terminal/common/scripts/psreadline/netstd/*.dll',
];

const serverWebResourcePatterns = [
	...serverResourcePatterns,
	...commonResourcePatterns,

	'dc/code/browser/workbench/workbench.html',
	'dc/code/browser/workbench/workbench-dev.html',
	'dc/code/browser/workbench/callback.html',
	'dc/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
	'dc/workbench/contrib/webview/browser/pre/*.html',

	'dc/workbench/contrib/webview/browser/pre/*.js',

	'dc/platform/accessibilitySignal/browser/media/*.mp3',
	'dc/workbench/contrib/agentsVoice/browser/media/*.mp3',

	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.svg',
	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.png',
	'dc/workbench/contrib/welcomeOnboarding/browser/media/*.svg',
	'dc/workbench/contrib/extensions/browser/media/*.svg',
	'dc/workbench/contrib/extensions/browser/media/*.png',
	'dc/workbench/services/extensionManagement/common/media/*.svg',
	'dc/workbench/services/extensionManagement/common/media/*.png',
];

const webResourcePatterns = [
	...commonResourcePatterns,

	'dc/code/browser/workbench/workbench.html',
	'dc/code/browser/workbench/workbench-dev.html',
	'dc/code/browser/workbench/callback.html',
	'dc/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html',
	'dc/workbench/contrib/webview/browser/pre/*.html',

	'dc/workbench/contrib/webview/browser/pre/*.js',

	'dc/platform/accessibilitySignal/browser/media/*.mp3',
	'dc/workbench/contrib/agentsVoice/browser/media/*.mp3',

	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.svg',
	'dc/workbench/contrib/welcomeGettingStarted/common/media/**/*.png',
	'dc/workbench/contrib/welcomeOnboarding/browser/media/*.svg',
	'dc/workbench/contrib/extensions/browser/media/*.svg',
	'dc/workbench/contrib/extensions/browser/media/*.png',
	'dc/workbench/services/extensionManagement/common/media/*.svg',
	'dc/workbench/services/extensionManagement/common/media/*.png',
];

function getResourcePatternsForTarget(target: BuildTarget): string[] {
	switch (target) {
		case 'desktop':
			return desktopResourcePatterns;
		case 'server':
			return serverResourcePatterns;
		case 'server-web':
			return serverWebResourcePatterns;
		case 'web':
			return webResourcePatterns;
		default:
			throw new Error(`Unknown target: ${target}`);
	}
}


async function cleanDir(dir: string): Promise<void> {
	const fullPath = path.join(REPO_ROOT, dir);
	console.log(`[clean] ${dir}`);
	try {
		await fs.promises.rm(fullPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	} catch {
		// Ignore transient lock error on Windows
	}
	await fs.promises.mkdir(fullPath, { recursive: true });
}

function scanBuiltinExtensions(extensionsRoot: string): Array<IScannedBuiltinExtension> {
	const scannedExtensions: Array<IScannedBuiltinExtension> = [];
	const extensionsPath = path.join(REPO_ROOT, extensionsRoot);

	if (!fs.existsSync(extensionsPath)) {
		return scannedExtensions;
	}

	for (const extensionFolder of fs.readdirSync(extensionsPath)) {
		const packageJSONPath = path.join(extensionsPath, extensionFolder, 'package.json');
		if (!fs.existsSync(packageJSONPath)) {
			continue;
		}
		try {
			const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath, 'utf8'));
			if (!isWebExtension(packageJSON)) {
				continue;
			}
			const children = fs.readdirSync(path.join(extensionsPath, extensionFolder));
			const packageNLSPath = children.filter(child => child === 'package.nls.json')[0];
			const packageNLS = packageNLSPath ? JSON.parse(fs.readFileSync(path.join(extensionsPath, extensionFolder, packageNLSPath), 'utf8')) : undefined;
			const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
			const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];

			scannedExtensions.push({
				extensionPath: extensionFolder,
				packageJSON,
				packageNLS,
				readmePath: readme ? path.join(extensionFolder, readme) : undefined,
				changelogPath: changelog ? path.join(extensionFolder, changelog) : undefined,
			});
		} catch (e) {
		}
	}

	return scannedExtensions;
}

function readISODate(outDir: string): string {
	try {
		return fs.readFileSync(path.join(REPO_ROOT, outDir, 'date'), 'utf8');
	} catch {
		return getGitCommitDate();
	}
}

function needsBomAdded(filePath: string): boolean {
	return /([\/\\])test\1.*utf8/.test(filePath);
}

async function copyFile(srcPath: string, destPath: string): Promise<void> {
	const dir = path.dirname(destPath);
	await fs.promises.mkdir(dir, { recursive: true });

	if (needsBomAdded(srcPath)) {
		const content = await fs.promises.readFile(srcPath);
		if (content[0] !== 0xef || content[1] !== 0xbb || content[2] !== 0xbf) {
			try {
				await fs.promises.writeFile(destPath, Buffer.concat([UTF8_BOM, content]));
			} catch (err: any) {
				if (err?.code === 'ENOENT' || err?.code === 'EPERM') {
					await fs.promises.mkdir(dir, { recursive: true });
					await new Promise(r => setTimeout(r, 50));
					await fs.promises.writeFile(destPath, Buffer.concat([UTF8_BOM, content]));
				} else {
					throw err;
				}
			}
			return;
		}
	}
	try {
		await fs.promises.copyFile(srcPath, destPath);
	} catch (err: any) {
		if (err?.code === 'ENOENT' || err?.code === 'EPERM') {
			await fs.promises.mkdir(dir, { recursive: true });
			await new Promise(r => setTimeout(r, 50));
			await fs.promises.copyFile(srcPath, destPath);
		} else {
			throw err;
		}
	}
}

async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (index < items.length) {
			const i = index++;
			await fn(items[i]);
		}
	});
	await Promise.all(workers);
}

const desktopStandaloneFiles = [
	'dc/base/parts/sandbox/electron-browser/preload.ts',
	'dc/base/parts/sandbox/electron-browser/preload-aux.ts',
	'dc/platform/browserView/electron-browser/preload-browserView.ts',
];

async function compileStandaloneFiles(outDir: string, doMinify: boolean, target: BuildTarget): Promise<void> {
	if (target !== 'desktop') {
		return;
	}

	console.log(`[standalone] Compiling ${desktopStandaloneFiles.length} standalone files...`);

	const banner = `/*!--------------------------------------------------------
 * Copyright (C) Dardcor Corporation. All rights reserved.
 *--------------------------------------------------------*/`;

	await Promise.all(desktopStandaloneFiles.map(async (file) => {
		const entryPath = path.join(REPO_ROOT, SRC_DIR, file);
		const outPath = path.join(REPO_ROOT, outDir, file.replace(/\.ts$/, '.js'));

		await esbuild.build({
			entryPoints: [entryPath],
			outfile: outPath,
			bundle: false,
			format: 'cjs',
			platform: 'node',
			target: ['es2024'],
			sourcemap: 'linked',
			sourcesContent: false,
			minify: doMinify,
			banner: { js: banner },
			logLevel: 'warning',
		});
	}));

	console.log(`[standalone] Done`);
}

async function copyAllNonTsFiles(outDir: string, excludeTests: boolean): Promise<void> {
	console.log(`[resources] Copying all non-TS files to ${outDir}...`);

	const ignorePatterns = [
		'**/*.ts',
	];
	if (excludeTests) {
		ignorePatterns.push('**/test/**');
	}

	const files = await globAsync('{*,**/*}', {
		cwd: path.join(REPO_ROOT, SRC_DIR),
		nodir: true,
		ignore: ignorePatterns,
	});

	const dtsFiles = await globAsync('{*.d.ts,**/*.d.ts}', {
		cwd: path.join(REPO_ROOT, SRC_DIR),
		ignore: excludeTests ? ['**/test/**'] : [],
	});

	const allFiles = [...new Set([...files, ...dtsFiles])];

	const concurrency = process.platform === 'win32' ? 32 : 64;
	await mapConcurrent(allFiles, concurrency, file => {
		const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
		const destPath = path.join(REPO_ROOT, outDir, file);
		return copyFile(srcPath, destPath);
	});

	console.log(`[resources] Copied ${allFiles.length} files`);
}

async function copyResources(outDir: string, target: BuildTarget): Promise<void> {
	console.log(`[resources] Copying to ${outDir} for target '${target}'...`);
	let copied = 0;

	const ignorePatterns = ['**/test/**', '**/*-dev.html'];

	const resourcePatterns = getResourcePatternsForTarget(target);
	for (const pattern of resourcePatterns) {
		const files = await globAsync(pattern, {
			cwd: path.join(REPO_ROOT, SRC_DIR),
			ignore: ignorePatterns,
		});

		for (const file of files) {
			const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
			const destPath = path.join(REPO_ROOT, outDir, file);

			await copyFile(srcPath, destPath);
			copied++;
		}
	}

	console.log(`[resources] Copied ${copied} files`);
}


function inlineMinimistPlugin(): esbuild.Plugin {
	return {
		name: 'inline-minimist',
		setup(build) {
			build.onResolve({ filter: /^minimist$/ }, () => ({
				path: path.join(REPO_ROOT, 'node_modules/minimist/index.js'),
				external: false,
			}));
		},
	};
}

function cssExternalPlugin(): esbuild.Plugin {
	return {
		name: 'css-external',
		setup(build) {
			build.onResolve({ filter: /\.css$/ }, (args) => ({
				path: args.path,
				external: true,
			}));
		},
	};
}

function fileContentMapperPlugin(outDir: string, target: BuildTarget): esbuild.Plugin {
	let productConfigReplacement: string | undefined;
	let builtinExtensionsReplacement: string | undefined;

	return {
		name: 'file-content-mapper',
		setup(build) {
			build.onLoad({ filter: /\.ts$/ }, async (args) => {
				if (args.path.endsWith('.d.ts')) {
					return undefined;
				}

				let contents = await fs.promises.readFile(args.path, 'utf-8');
				let modified = false;

				if (contents.includes('/*BUILD->INSERT_PRODUCT_CONFIGURATION*/')) {
					if (productConfigReplacement === undefined) {
						const productForTarget = target === 'server-web'
							? { ...product, webEndpointUrlTemplate: undefined }
							: product;
						const productConfiguration = JSON.stringify({
							...productForTarget,
							version,
							commit,
							date: readISODate(outDir)
						});
						productConfigReplacement = productConfiguration.substring(1, productConfiguration.length - 1);
					}
					contents = contents.replace('/*BUILD->INSERT_PRODUCT_CONFIGURATION*/', () => productConfigReplacement!);
					modified = true;
				}

				if (contents.includes('/*BUILD->INSERT_BUILTIN_EXTENSIONS*/')) {
					if (builtinExtensionsReplacement === undefined) {
						const extensionsRoot = target === 'web' ? '.build/web/extensions' : '.build/extensions';
						const builtinExtensions = JSON.stringify(scanBuiltinExtensions(extensionsRoot));
						builtinExtensionsReplacement = builtinExtensions.substring(1, builtinExtensions.length - 1);
					}
					contents = contents.replace('/*BUILD->INSERT_BUILTIN_EXTENSIONS*/', () => builtinExtensionsReplacement!);
					modified = true;
				}

				if (modified) {
					return { contents, loader: 'ts' };
				}

				return undefined;
			});
		},
	};
}


const transformOptions: esbuild.TransformOptions = {
	loader: 'ts',
	format: 'esm',
	target: 'es2024',
	sourcemap: 'inline',
	sourcesContent: false,
	tsconfigRaw: JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	}),
};

async function transpileFile(srcPath: string, destPath: string): Promise<void> {
	const source = await fs.promises.readFile(srcPath, 'utf-8');
	const result = await esbuild.transform(source, {
		...transformOptions,
		sourcefile: srcPath,
	});

	const dir = path.dirname(destPath);
	await fs.promises.mkdir(dir, { recursive: true });

	const adjustedCode = adjustEsmUrl(result.code);
	try {
		await fs.promises.writeFile(destPath, adjustedCode);
	} catch (err: any) {
		if (err?.code === 'ENOENT' || err?.code === 'EPERM') {
			await fs.promises.mkdir(dir, { recursive: true });
			await new Promise(r => setTimeout(r, 50));
			await fs.promises.writeFile(destPath, adjustedCode);
		} else {
			throw err;
		}
	}
}

function adjustEsmUrl(code: string): string {
	const fixedCode = code.replace(/\.ts(\?esm['"])/g, '.js$1');
	return fixedCode;
}

async function transpile(outDir: string, excludeTests: boolean): Promise<void> {
	const ignorePatterns = ['**/*.d.ts'];
	if (excludeTests) {
		ignorePatterns.push('**/test/**');
	}

	const files = await globAsync('{*.ts,**/*.ts}', {
		cwd: path.join(REPO_ROOT, SRC_DIR),
		ignore: ignorePatterns,
	});

	console.log(`[transpile] Found ${files.length} files`);

	const concurrency = process.platform === 'win32' ? 32 : 64;
	await mapConcurrent(files, concurrency, file => {
		const srcPath = path.join(REPO_ROOT, SRC_DIR, file);
		const destPath = path.join(REPO_ROOT, outDir, file.replace(/\.ts$/, '.js'));
		return transpileFile(srcPath, destPath);
	});
}


async function bundle(outDir: string, doMinify: boolean, doNls: boolean, doManglePrivates: boolean, target: BuildTarget, sourceMapBaseUrl?: string): Promise<void> {
	await cleanDir(outDir);

	const outDirPath = path.join(REPO_ROOT, outDir);
	await fs.promises.mkdir(outDirPath, { recursive: true });
	let buildDate: string;
	try {
		buildDate = await fs.promises.readFile(path.join(REPO_ROOT, 'out-build', 'date'), 'utf8');
	} catch {
		buildDate = getGitCommitDate();
	}
	await fs.promises.writeFile(path.join(outDirPath, 'date'), buildDate, 'utf8');

	console.log(`[bundle] ${SRC_DIR} → ${outDir} (target: ${target})${doMinify ? ' (minify)' : ''}${doNls ? ' (nls)' : ''}${doManglePrivates ? ' (mangle-privates)' : ''}`);
	const t1 = Date.now();

	const tslibPath = path.join(REPO_ROOT, 'node_modules/tslib/tslib.es6.js');
	const tslib = await fs.promises.readFile(tslibPath, 'utf-8');
	const banner = {
		js: `/*!--------------------------------------------------------
 * Copyright (C) Dardcor Corporation. All rights reserved.
 *--------------------------------------------------------*/
${tslib}`,
		css: `/*!--------------------------------------------------------
 * Copyright (C) Dardcor Corporation. All rights reserved.
 *--------------------------------------------------------*/`,
	};

	const tsconfigRaw = JSON.stringify({
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false
		}
	});

	const nlsCollector = createNLSCollector();
	const preserveEnglish = false;

	const allEntryPoints = getEntryPointsForTarget(target);
	const bootstrapEntryPoints = getBootstrapEntryPointsForTarget(target);
	const bundleCssEntryPoints = getCssBundleEntryPointsForTarget(target);

	const buildResults: { outPath: string; result: esbuild.BuildResult }[] = [];

	const contentMapperPlugin = fileContentMapperPlugin(outDir, target);

	await Promise.all(allEntryPoints.map(async (entryPoint) => {
		const entryPath = path.join(REPO_ROOT, SRC_DIR, `${entryPoint}.ts`);
		const outPath = path.join(REPO_ROOT, outDir, `${entryPoint}.js`);

		const plugins: esbuild.Plugin[] = bundleCssEntryPoints.has(entryPoint) ? [] : [cssExternalPlugin()];
		plugins.push(contentMapperPlugin);
		if (doNls) {
			plugins.unshift(nlsPlugin({
				baseDir: path.join(REPO_ROOT, SRC_DIR),
				collector: nlsCollector,
			}));
		}

		const needsCssBundling = bundleCssEntryPoints.has(entryPoint);

		const buildOptions: esbuild.BuildOptions = {
			entryPoints: needsCssBundling
				? [{ in: entryPath, out: entryPoint }]
				: [entryPath],
			...(needsCssBundling
				? { outdir: path.join(REPO_ROOT, outDir) }
				: { outfile: outPath }),
			bundle: true,
			format: 'esm',
			platform: 'neutral',
			target: ['es2024'],
			packages: 'external',
			sourcemap: 'linked',
			sourcesContent: true,
			minify: doMinify,
			treeShaking: true,
			banner,
			loader: {
				'.ttf': 'file',
				'.svg': 'file',
				'.png': 'file',
				'.sh': 'file',
			},
			assetNames: 'media/[name]',
			plugins,
			write: false,
			logLevel: 'warning',
			logOverride: {
				'unsupported-require-call': 'silent',
			},
			tsconfigRaw,
		};

		const result = await esbuild.build(buildOptions);

		buildResults.push({ outPath, result });
	}));

	for (const entry of bootstrapEntryPoints) {
		const entryPath = path.join(REPO_ROOT, SRC_DIR, `${entry}.ts`);
		if (!fs.existsSync(entryPath)) {
			console.log(`[bundle] Skipping ${entry} (not found)`);
			continue;
		}

		const outPath = path.join(REPO_ROOT, outDir, `${entry}.js`);

		const bootstrapPlugins: esbuild.Plugin[] = [inlineMinimistPlugin(), contentMapperPlugin];
		if (doNls) {
			bootstrapPlugins.unshift(nlsPlugin({
				baseDir: path.join(REPO_ROOT, SRC_DIR),
				collector: nlsCollector,
			}));
		}

		const result = await esbuild.build({
			entryPoints: [entryPath],
			outfile: outPath,
			bundle: true,
			format: 'esm',
			platform: 'node',
			target: ['es2024'],
			packages: 'external',
			sourcemap: 'linked',
			sourcesContent: true,
			minify: doMinify,
			treeShaking: true,
			banner,
			plugins: bootstrapPlugins,
			write: false,
			logLevel: 'warning',
			logOverride: {
				'unsupported-require-call': 'silent',
			},
			tsconfigRaw,
		});

		buildResults.push({ outPath, result });
	}

	let indexMap = new Map<string, number>();
	if (doNls) {
		const nlsResult = await finalizeNLS(
			nlsCollector,
			path.join(REPO_ROOT, outDir),
			[path.join(REPO_ROOT, 'out-build')]
		);
		indexMap = nlsResult.indexMap;
	}

	let bundled = 0;
	const mangleStats: { file: string; result: ConvertPrivateFieldsResult }[] = [];
	const mangleEdits = new Map<string, { preMangleCode: string; edits: readonly import('./private-to-property.ts').TextEdit[] }>();
	const nlsEdits = new Map<string, { preNLSCode: string; edits: readonly import('./private-to-property.ts').TextEdit[] }>();
	const deferredMaps: { path: string; text: string; contents: Uint8Array }[] = [];
	for (const { result } of buildResults) {
		if (!result.outputFiles) {
			continue;
		}

		for (const file of result.outputFiles) {
			await fs.promises.mkdir(path.dirname(file.path), { recursive: true });

			if (file.path.endsWith('.js') || file.path.endsWith('.css')) {
				let content = file.text;

				if (file.path.endsWith('.js') && doManglePrivates && !isExtensionHostBundle(file.path)) {
					const preMangleCode = content;
					const mangleResult = convertPrivateFields(content, file.path);
					content = mangleResult.code;
					if (mangleResult.editCount > 0) {
						mangleStats.push({ file: path.relative(path.join(REPO_ROOT, outDir), file.path), result: mangleResult });
						mangleEdits.set(file.path, { preMangleCode, edits: mangleResult.edits });
					}
				}

				if (file.path.endsWith('.js') && doNls && indexMap.size > 0) {
					const preNLSCode = content;
					const nlsResult = postProcessNLS(content, indexMap, preserveEnglish);
					content = nlsResult.code;
					if (nlsResult.edits.length > 0) {
						nlsEdits.set(file.path, { preNLSCode, edits: nlsResult.edits });
					}
				}

				// Rewrite sourceMappingURL to CDN URL if configured
				if (sourceMapBaseUrl) {
					const relativePath = path.relative(path.join(REPO_ROOT, outDir), file.path);
					content = content.replace(
						/\/\/# sourceMappingURL=.+$/m,
						`//# sourceMappingURL=${sourceMapBaseUrl}/${relativePath}.map`
					);
					content = content.replace(
						/\/\*# sourceMappingURL=.+\*\/$/m,
						`/*# sourceMappingURL=${sourceMapBaseUrl}/${relativePath}.map*/`
					);
				}

				await fs.promises.writeFile(file.path, content);
			} else if (file.path.endsWith('.map')) {
				deferredMaps.push({ path: file.path, text: file.text, contents: file.contents });
			} else {
				await fs.promises.writeFile(file.path, file.contents);
			}
		}
		bundled++;
	}

	for (const mapFile of deferredMaps) {
		const jsPath = mapFile.path.replace(/\.map$/, '');
		const mangle = mangleEdits.get(jsPath);
		const nls = nlsEdits.get(jsPath);

		if (mangle || nls) {
			let mapJson = JSON.parse(mapFile.text);
			if (mangle) {
				mapJson = adjustSourceMap(mapJson, mangle.preMangleCode, mangle.edits);
			}
			if (nls) {
				mapJson = adjustSourceMap(mapJson, nls.preNLSCode, nls.edits);
			}
			await fs.promises.writeFile(mapFile.path, JSON.stringify(mapJson));
		} else {
			await fs.promises.writeFile(mapFile.path, mapFile.contents);
		}
	}

	const postProcessedFiles = new Set([...mangleEdits.keys(), ...nlsEdits.keys()]);
	if (postProcessedFiles.size > 0) {
		const errors = (await Promise.all([...postProcessedFiles].map(async jsPath => {
			try {
				const src = await fs.promises.readFile(jsPath, 'utf-8');
				await esbuild.transform(src, { loader: 'js', format: 'esm' });
				return undefined;
			} catch (e: unknown) {
				const rel = path.relative(path.join(REPO_ROOT, outDir), jsPath);
				const message = e instanceof Error ? e.message : String(e);
				return { rel, message };
			}
		}))).filter(error => error !== undefined).sort((a, b) => a.rel.localeCompare(b.rel));
		if (errors.length > 0) {
			throw new Error(`[bundle] Syntax errors in post-processed JS files:\n${errors.map(e => `${e.rel}: ${e.message}`).join('\n')}`);
		}
		console.log(`[bundle] Syntax check passed for ${postProcessedFiles.size} post-processed JS files`);
	}

	if (doManglePrivates && mangleStats.length > 0) {
		let totalClasses = 0, totalFields = 0, totalEdits = 0, totalElapsed = 0;
		for (const { file, result } of mangleStats) {
			console.log(`[mangle-privates] ${file}: ${result.classCount} classes, ${result.fieldCount} fields, ${result.editCount} edits, ${result.elapsed}ms`);
			totalClasses += result.classCount;
			totalFields += result.fieldCount;
			totalEdits += result.editCount;
			totalElapsed += result.elapsed;
		}
		console.log(`[mangle-privates] Total: ${totalClasses} classes, ${totalFields} fields, ${totalEdits} edits, ${totalElapsed}ms`);
	}

	await copyResources(outDir, target);

	await compileStandaloneFiles(outDir, doMinify, target);

	console.log(`[bundle] Done in ${Date.now() - t1}ms (${bundled} bundles)`);
}


async function watch(): Promise<void> {
	if (!useEsbuildTranspile) {
		console.log('Starting transpilation...');
		console.log('Finished transpilation with 0 errors after 0 ms');
		console.log('[watch] esbuild transpile disabled (useEsbuildTranspile=false). Keeping process alive as no-op.');
		await new Promise(() => { });
		return;
	}

	console.log('Starting transpilation...');

	const outDir = OUT_DIR;

	await cleanDir(outDir);
	console.log(`[transpile] ${SRC_DIR} → ${outDir}`);

	const t1 = Date.now();
	try {
		await transpile(outDir, false);
		await copyAllNonTsFiles(outDir, false);
		await fs.promises.writeFile(
			path.join(REPO_ROOT, outDir, '.build-done'),
			JSON.stringify({
				timestamp: new Date().toISOString(),
				status: 'complete'
			}, null, 2),
			'utf8'
		);
		console.log(`Finished transpilation with 0 errors after ${Date.now() - t1} ms`);
	} catch (err) {
		console.error('[watch] Initial build failed:', err);
		console.log(`Finished transpilation with 1 errors after ${Date.now() - t1} ms`);
	}

	let pendingTsFiles: Set<string> = new Set();
	let pendingCopyFiles: Set<string> = new Set();

	const processChanges = async () => {
		console.log('Starting transpilation...');
		const t1 = Date.now();
		const tsFiles = [...pendingTsFiles];
		const filesToCopy = [...pendingCopyFiles];
		pendingTsFiles = new Set();
		pendingCopyFiles = new Set();

		try {
			if (tsFiles.length > 0) {
				console.log(`[watch] Transpiling ${tsFiles.length} file(s)...`);
				await Promise.all(tsFiles.map(srcPath => {
					const relativePath = path.relative(path.join(REPO_ROOT, SRC_DIR), srcPath);
					const destPath = path.join(REPO_ROOT, outDir, relativePath.replace(/\.ts$/, '.js'));
					return transpileFile(srcPath, destPath);
				}));
			}

			if (filesToCopy.length > 0) {
				await Promise.all(filesToCopy.map(async (srcPath) => {
					const relativePath = path.relative(path.join(REPO_ROOT, SRC_DIR), srcPath);
					const destPath = path.join(REPO_ROOT, outDir, relativePath);
					await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
					await fs.promises.copyFile(srcPath, destPath);
					console.log(`[watch] Copied ${relativePath}`);
				}));
			}

			if (tsFiles.length > 0 || filesToCopy.length > 0) {
				console.log(`Finished transpilation with 0 errors after ${Date.now() - t1} ms`);
			}
		} catch (err) {
			console.error('[watch] Rebuild failed:', err);
			console.log(`Finished transpilation with 1 errors after ${Date.now() - t1} ms`);
		}
	};

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	const srcDir = path.join(REPO_ROOT, SRC_DIR);
	const watchStream = gulpWatch('src/**', { base: srcDir, readDelay: 200 });

	watchStream.on('data', (file: { path: string }) => {
		if (file.path.endsWith('.ts') && !file.path.endsWith('.d.ts')) {
			pendingTsFiles.add(file.path);
		} else {
			pendingCopyFiles.add(file.path);
		}

		if (pendingTsFiles.size > 0 || pendingCopyFiles.size > 0) {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(processChanges, 200);
		}
	});

	console.log('[watch] Watching src/**/*.{ts,css,...} (Ctrl+C to stop)');

	process.on('SIGINT', () => {
		console.log('\n[watch] Stopping...');
		watchStream.end();
		process.exit(0);
	});
}


function printUsage(): void {
	console.log(`Usage: npx tsx build/next/index.ts <command> [options]

Commands:
	transpile          Transpile TypeScript to JavaScript (single-file, fast)
	bundle             Bundle entry points into optimized bundles

Options for 'transpile':
	--watch            Watch for changes and rebuild incrementally
	--out <dir>        Output directory (default: out)
	--exclude-tests    Exclude test files from transpilation

Options for 'bundle':
	--minify           Minify the output bundles
	--nls              Process NLS (localization) strings
	--mangle-privates  Convert native #private fields to regular properties
	--out <dir>        Output directory (default: out-dardcor-code)
	--target <target>  Build target: desktop (default), server, server-web, web
	--source-map-base-url <url>  Rewrite sourceMappingURL to CDN URL

Examples:
	npx tsx build/next/index.ts transpile
	npx tsx build/next/index.ts transpile --watch
	npx tsx build/next/index.ts transpile --out out-build
	npx tsx build/next/index.ts transpile --out out-build --exclude-tests
	npx tsx build/next/index.ts bundle
	npx tsx build/next/index.ts bundle --minify --nls
	npx tsx build/next/index.ts bundle --nls --out out-dardcor-code-min
	npx tsx build/next/index.ts bundle --minify --nls --target server --out out-dardcor-code-reh-min
	npx tsx build/next/index.ts bundle --minify --nls --target server-web --out out-dardcor-code-reh-web-min
`);
}

async function main(): Promise<void> {
	const t1 = Date.now();

	try {
		switch (command) {
			case 'transpile':
				if (options.watch) {
					await watch();
				} else {
					const outDir = options.out ?? OUT_DIR;
					await cleanDir(outDir);

					const outDirPath = path.join(REPO_ROOT, outDir);
					await fs.promises.mkdir(outDirPath, { recursive: true });
					await fs.promises.writeFile(path.join(outDirPath, 'date'), getGitCommitDate(), 'utf8');

					console.log(`[transpile] ${SRC_DIR} → ${outDir}${options.excludeTests ? ' (excluding tests)' : ''}`);
					const t1 = Date.now();
					await transpile(outDir, options.excludeTests);
					await copyAllNonTsFiles(outDir, options.excludeTests);
					await fs.promises.writeFile(
						path.join(outDirPath, '.build-done'),
						JSON.stringify({
							timestamp: new Date().toISOString(),
							status: 'complete'
						}, null, 2),
						'utf8'
					);
					console.log(`[transpile] Done in ${Date.now() - t1}ms`);
				}
				break;

			case 'bundle':
				await bundle(options.out ?? OUT_VSCODE_DIR, options.minify, options.nls, options.manglePrivates, options.target as BuildTarget, options.sourceMapBaseUrl);
				break;

			default:
				printUsage();
				process.exit(command ? 1 : 0);
		}

		if (!options.watch) {
			console.log(`\n✓ Total: ${Date.now() - t1}ms`);
		}
	} catch (err) {
		console.error('Build failed:', err);
		process.exit(1);
	}
}

main();
