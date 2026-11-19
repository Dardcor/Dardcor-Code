/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import vfs from 'vinyl-fs';
import { filter, jsonEditor } from './gulp/facade.ts';
import * as util from './util.ts';
import { getVersion } from './getVersion.ts';
import { downloadFeedPackage } from './azureFeed.ts';
import { ensureWindowsElectronPermissions } from './windowsElectronPermissions.ts';
import electron from '@vscode/gulp-electron';

type DarwinDocumentSuffix = 'document' | 'script' | 'file' | 'source code';
type DarwinDocumentType = {
	name: string;
	role: string;
	ostypes: string[];
	extensions: string[];
	iconFile: string;
	utis?: string[];
};

function isDocumentSuffix(str?: string): str is DarwinDocumentSuffix {
	return str === 'document' || str === 'script' || str === 'file' || str === 'source code';
}

const root = path.dirname(path.dirname(import.meta.dirname));
const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
const commit = getVersion(root);
const useVersionedUpdate = process.platform === 'win32' && (product as typeof product & { win32VersionedUpdate?: boolean })?.win32VersionedUpdate;
const versionedResourcesFolder = useVersionedUpdate ? commit!.substring(0, 10) : '';

function createTemplate(input: string): (params: Record<string, string>) => string {
	return (params: Record<string, string>) => {
		return input.replace(/<%=\s*([^\s]+)\s*%>/g, (match, key) => {
			return params[key] || match;
		});
	};
}

const darwinCreditsTemplate = product.darwinCredits && createTemplate(fs.readFileSync(path.join(root, product.darwinCredits), 'utf8'));

function darwinBundleDocumentType(extensions: string[], icon: string, nameOrSuffix?: string | DarwinDocumentSuffix, utis?: string[]): DarwinDocumentType {
	if (isDocumentSuffix(nameOrSuffix) || !nameOrSuffix) {
		nameOrSuffix = icon.charAt(0).toUpperCase() + icon.slice(1) + ' ' + (nameOrSuffix ?? 'document');
	}

	return {
		name: nameOrSuffix,
		role: 'Editor',
		ostypes: ['TEXT', 'utxt', 'TUTX', '****'],
		extensions,
		iconFile: 'resources/darwin/' + icon.toLowerCase() + '.icns',
		utis
	};
}

function darwinBundleDocumentTypes(types: { [name: string]: string | string[] }, icon: string): DarwinDocumentType[] {
	return Object.keys(types).map((name: string): DarwinDocumentType => {
		const extensions = types[name];
		return {
			name,
			role: 'Editor',
			ostypes: ['TEXT', 'utxt', 'TUTX', '****'],
			extensions: Array.isArray(extensions) ? extensions : [extensions],
			iconFile: 'resources/darwin/' + icon + '.icns'
		};
	});
}

const { electronVersion, msBuildId } = util.getElectronVersion();

const electronFeed: string | undefined = product.electronArtifactFeed;
if (electronFeed && !msBuildId) {
	throw new Error('The configured Electron artifact feed requires dardcorBuild.electronMsBuildId in package.json.');
}

function feedPackageName(fileName: string): string | undefined {
	if (fileName === 'SHASUMS256.txt') {
		return 'shasums256';
	}
	if (fileName.endsWith('-symbols.zip')) {
		return undefined;
	}
	return fileName.replace(/\.zip$/, '');
}

function readElectronChecksums(checksumFile: string): Record<string, string> {
	const checksums: Record<string, string> = Object.create(null);
	for (const line of fs.readFileSync(checksumFile, 'utf8').split(/\r?\n/)) {
		const match = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
		if (match) {
			checksums[match[2]] = match[1].toLowerCase();
		}
	}

	if (Object.keys(checksums).length === 0) {
		throw new Error(`No valid Electron artifact checksums were found in ${checksumFile}.`);
	}

	return checksums;
}

const electronChecksums = readElectronChecksums(path.join(root, 'build', 'checksums', 'electron.txt'));

const electronAssetResolver = electronFeed
	? async ({ fileName }: { url: string; fileName: string }): Promise<Response> => {
		const name = feedPackageName(fileName);
		if (!name) {
			return new Response(null, { status: 404 });
		}
		const version = `${electronVersion}-${msBuildId}`;
		const filePath = await downloadFeedPackage(root, 'electron-feed', { feed: electronFeed, name, version });
		const size = (await fs.promises.stat(filePath)).size;
		const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
		return new Response(body, { status: 200, headers: { 'Content-Length': String(size) } });
	}
	: undefined;

export const config = {
	version: electronVersion,
	productAppName: product.nameLong,
	companyName: 'Dardcor Corporation',
	copyright: 'Copyright (C) 2026 Microsoft. All rights reserved',
	darwinExecutable: product.nameShort,
	darwinIcon: fs.existsSync(path.join(root, 'resources/darwin/dardcor-code.icns'))
		? path.join(root, 'resources/darwin/dardcor-code.icns')
		: path.join(root, 'resources/darwin/code.icns'),
	darwinBundleIdentifier: product.darwinBundleIdentifier,
	darwinApplicationCategoryType: 'public.app-category.developer-tools',
	darwinHelpBookFolder: 'VS Code HelpBook',
	darwinHelpBookName: 'VS Code HelpBook',
	darwinBundleDocumentTypes: [
		...darwinBundleDocumentTypes({ 'C header file': 'h', 'C source code': 'c' }, 'c'),
		...darwinBundleDocumentTypes({ 'Git configuration file': ['gitattributes', 'gitconfig', 'gitignore'] }, 'config'),
		...darwinBundleDocumentTypes({ 'HTML template document': ['asp', 'aspx', 'cshtml', 'jshtm', 'jsp', 'phtml', 'shtml'] }, 'html'),
		darwinBundleDocumentType(['bat', 'cmd'], 'bat', 'Windows command script'),
		darwinBundleDocumentType(['bowerrc'], 'Bower'),
		darwinBundleDocumentType(['config', 'editorconfig', 'ini', 'cfg'], 'config', 'Configuration file'),
		darwinBundleDocumentType(['hh', 'hpp', 'hxx', 'h++'], 'cpp', 'C++ header file'),
		darwinBundleDocumentType(['cc', 'cpp', 'cxx', 'c++'], 'cpp', 'C++ source code'),
		darwinBundleDocumentType(['m'], 'default', 'Objective-C source code'),
		darwinBundleDocumentType(['mm'], 'cpp', 'Objective-C++ source code'),
		darwinBundleDocumentType(['cs', 'csx'], 'csharp', 'C# source code'),
		darwinBundleDocumentType(['css'], 'css', 'CSS'),
		darwinBundleDocumentType(['go'], 'go', 'Go source code'),
		darwinBundleDocumentType(['htm', 'html', 'xhtml'], 'HTML'),
		darwinBundleDocumentType(['jade'], 'Jade'),
		darwinBundleDocumentType(['jav', 'java'], 'Java'),
		darwinBundleDocumentType(['js', 'jscsrc', 'jshintrc', 'mjs', 'cjs'], 'Javascript', 'file'),
		darwinBundleDocumentType(['json'], 'JSON'),
		darwinBundleDocumentType(['less'], 'Less'),
		darwinBundleDocumentType(['markdown', 'md', 'mdoc', 'mdown', 'mdtext', 'mdtxt', 'mdwn', 'mkd', 'mkdn'], 'Markdown'),
		darwinBundleDocumentType(['php'], 'PHP', 'source code'),
		darwinBundleDocumentType(['ps1', 'psd1', 'psm1'], 'Powershell', 'script'),
		darwinBundleDocumentType(['py', 'pyi'], 'Python', 'script'),
		darwinBundleDocumentType(['gemspec', 'rb', 'erb'], 'Ruby', 'source code'),
		darwinBundleDocumentType(['scss', 'sass'], 'SASS', 'file'),
		darwinBundleDocumentType(['sql'], 'SQL', 'script'),
		darwinBundleDocumentType(['ts'], 'TypeScript', 'file'),
		darwinBundleDocumentType(['tsx', 'jsx'], 'React', 'source code'),
		darwinBundleDocumentType(['vue'], 'Vue', 'source code'),
		darwinBundleDocumentType(['ascx', 'csproj', 'dtd', 'plist', 'wxi', 'wxl', 'wxs', 'xml', 'xaml'], 'XML'),
		darwinBundleDocumentType(['eyaml', 'eyml', 'yaml', 'yml'], 'YAML'),
		darwinBundleDocumentType([
			'bash', 'bash_login', 'bash_logout', 'bash_profile', 'bashrc',
			'profile', 'rhistory', 'rprofile', 'sh', 'zlogin', 'zlogout',
			'zprofile', 'zsh', 'zshenv', 'zshrc'
		], 'Shell', 'script'),
		...darwinBundleDocumentTypes({
			'Clojure source code': ['clj', 'cljs', 'cljx', 'clojure'],
			'VS Code workspace file': 'code-workspace',
			'CoffeeScript source code': 'coffee',
			'Comma Separated Values': 'csv',
			'CMake script': 'cmake',
			'Dart script': 'dart',
			'Diff file': 'diff',
			'Dockerfile': 'dockerfile',
			'Gradle file': 'gradle',
			'Groovy script': 'groovy',
			'Makefile': ['makefile', 'mk'],
			'Lua script': 'lua',
			'Pug document': 'pug',
			'Jupyter': 'ipynb',
			'Lockfile': 'lock',
			'Log file': 'log',
			'Plain Text File': 'txt',
			'Xcode project file': 'xcodeproj',
			'Xcode workspace file': 'xcworkspace',
			'Visual Basic script': 'vb',
			'R source code': 'r',
			'Rust source code': 'rs',
			'Restructured Text document': 'rst',
			'LaTeX document': ['tex', 'cls'],
			'F# source code': 'fs',
			'F# signature file': 'fsi',
			'F# script': ['fsx', 'fsscript'],
			'SVG document': ['svg'],
			'TOML document': 'toml',
			'Swift source code': 'swift',
		}, 'default'),
		darwinBundleDocumentType([
			'containerfile', 'ctp', 'dot', 'edn', 'handlebars', 'hbs', 'ml', 'mli',
			'pl', 'pl6', 'pm', 'pm6', 'pod', 'pp', 'properties', 'psgi', 'rt', 't'
		], 'default', product.nameLong + ' document'),
		darwinBundleDocumentType([], 'default', 'Folder', ['public.folder'])
	],
	darwinBundleURLTypes: [{
		role: 'Viewer',
		name: product.nameLong,
		urlSchemes: [product.urlProtocol]
	}],
	darwinForceDarkModeSupport: true,
	darwinCredits: darwinCreditsTemplate ? Buffer.from(darwinCreditsTemplate({ commit: commit, date: new Date().toISOString() })) : undefined,
	linuxExecutableName: product.applicationName,
	winIcon: path.join(root, 'public/dardcor-code.ico'),
	token: process.env['GITHUB_TOKEN'],
	repo: electronAssetResolver,
	checksums: electronChecksums,
	validateChecksum: true,
	checksumFile: path.join(root, 'build', 'checksums', 'electron.txt'),
	createVersionedResources: useVersionedUpdate,
	productVersionString: versionedResourcesFolder,
};

type ElectronBuildStreams = {
	completionStream: NodeJS.ReadWriteStream;
	streams: NodeJS.ReadWriteStream[];
};

function getElectron(arch: string, destinationPath: string): ElectronBuildStreams {
	const electronOpts = {
		...config,
		platform: process.platform,
		arch: arch === 'armhf' ? 'arm' : arch,
		ffmpegChromium: false,
		keepDefaultApp: true
	};

	const packageStream = vfs.src('package.json');
	const renamedPackageStream = packageStream.pipe(jsonEditor({ name: product.nameShort }));
	const electronStream = renamedPackageStream.pipe(electron(electronOpts));
	const filteredElectronStream = electronStream.pipe(filter(['**', '!**/app/package.json']));
	const destinationStream = filteredElectronStream.pipe(vfs.dest(destinationPath));

	return {
		completionStream: destinationStream,
		streams: [packageStream, renamedPackageStream, electronStream, filteredElectronStream, destinationStream]
	};
}

function waitForStreamCompletion(streams: readonly NodeJS.ReadWriteStream[]): Promise<void> {
	const completionStream = streams[streams.length - 1];
	if (!completionStream) {
		return Promise.reject(new Error('Electron build pipeline has no completion stream.'));
	}

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			for (const stream of streams) {
				stream.removeListener('error', onError);
			}
			completionStream.removeListener('end', onEnd);
		};
		const onError = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			for (const stream of streams) {
				const destroyable = stream as NodeJS.ReadWriteStream & { destroy?: () => void };
				if (typeof destroyable.destroy === 'function') {
					destroyable.on('error', () => undefined);
					destroyable.destroy();
				}
			}
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		const onEnd = () => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			resolve();
		};

		for (const stream of streams) {
			stream.once('error', onError);
		}
		completionStream.once('end', onEnd);
	});
}

async function pathExists(target: string): Promise<boolean> {
	try {
		await fs.promises.stat(target);
		return true;
	} catch {
		return false;
	}
}

async function validateElectronOutput(destinationPath: string): Promise<void> {
	const versionRoot = path.join(destinationPath, versionedResourcesFolder);
	const versionFile = path.join(versionRoot, 'version');
	const installedVersion = (await fs.promises.readFile(versionFile, 'utf8')).trim().replace(/^v/, '');
	if (installedVersion !== electronVersion) {
		throw new Error(`Electron output version mismatch: expected ${electronVersion}, received ${installedVersion || 'empty'}.`);
	}

	if (process.platform === 'win32') {
		const requiredFiles = [
			path.join(destinationPath, `${product.nameShort}.exe`),
			path.join(versionRoot, 'icudtl.dat'),
			path.join(versionRoot, 'resources.pak')
		];
		for (const file of requiredFiles) {
			const stat = await fs.promises.stat(file);
			if (!stat.isFile() || stat.size === 0) {
				throw new Error(`Electron output is incomplete: ${file} is missing or empty.`);
			}
		}
	}
}

async function promoteElectronOutput(stagingPath: string, electronPath: string, backupPath: string): Promise<void> {
	const hasPreviousOutput = await pathExists(electronPath);
	if (hasPreviousOutput) {
		await fs.promises.rename(electronPath, backupPath);
	}

	try {
		await fs.promises.rename(stagingPath, electronPath);
	} catch (error) {
		if (hasPreviousOutput) {
			try {
				await fs.promises.rename(backupPath, electronPath);
			} catch (restoreError) {
				throw new Error(`Electron replacement failed and the previous runtime could not be restored from ${backupPath}.`, { cause: restoreError });
			}
		}
		throw error;
	}

	if (hasPreviousOutput) {
		try {
			await fs.promises.rm(backupPath, { recursive: true, force: true });
		} catch (error) {
			console.warn(`[electron] The new runtime is ready, but the old backup could not be removed: ${backupPath}`, error);
		}
	}
}

async function main(arch: string = process.arch): Promise<void> {
	const electronPath = path.join(root, '.build', 'electron');
	const buildRoot = path.dirname(electronPath);
	const uniqueSuffix = `${process.pid}-${Date.now()}`;
	const stagingPath = path.join(buildRoot, `.electron-staging-${uniqueSuffix}`);
	const backupPath = path.join(buildRoot, `.electron-backup-${uniqueSuffix}`);
	await fs.promises.mkdir(buildRoot, { recursive: true });

	try {
		const streams = getElectron(arch, stagingPath);
		await waitForStreamCompletion(streams.streams);
		await validateElectronOutput(stagingPath);
		await ensureWindowsElectronPermissions(stagingPath);
		await promoteElectronOutput(stagingPath, electronPath, backupPath);
	} catch (error) {
		try {
			await fs.promises.rm(stagingPath, { recursive: true, force: true });
		} catch (cleanupError) {
			console.warn(`[electron] Could not remove incomplete staging runtime: ${stagingPath}`, cleanupError);
		}
		throw new Error(`Failed to prepare Electron ${electronVersion} for ${process.platform}-${arch}; any previous runtime was preserved.`, { cause: error });
	}
}

if (import.meta.main) {
	main(process.argv[2]).catch(err => {
		console.error(err);
		process.exitCode = 1;
	});
}
