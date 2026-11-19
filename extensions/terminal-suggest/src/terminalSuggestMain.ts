/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExecOptionsWithStringEncoding } from 'child_process';
import * as fs from 'fs';
import { basename, delimiter } from 'path';
import * as vscode from 'vscode';
import azdSpec from './completions/azd';
import cdSpec from './completions/cd';
import codeCompletionSpec from './completions/code';
import codeInsidersCompletionSpec from './completions/code-insiders';
import codeTunnelCompletionSpec from './completions/code-tunnel';
import codeTunnelInsidersCompletionSpec from './completions/code-tunnel-insiders';
import gitCompletionSpec from './completions/git';
import ghCompletionSpec from './completions/gh';
import npmCompletionSpec from './completions/npm';
import npxCompletionSpec from './completions/npx';
import pnpmCompletionSpec from './completions/pnpm';
import setLocationSpec from './completions/set-location';
import yarnCompletionSpec from './completions/yarn';
import * as upstreamSpecs from './upstreamSpecs';
import { ITerminalEnvironment, PathExecutableCache } from './env/pathExecutableCache';
import { executeCommand, executeCommandTimeout, IFigExecuteExternals } from './fig/execute';
import { getFigSuggestions } from './fig/figInterface';
import { createCompletionItem } from './helpers/completionItem';
import { osIsWindows } from './helpers/os';
import { createTimeoutPromise } from './helpers/promise';
import { getFriendlyResourcePath } from './helpers/uri';
import { getBashGlobals } from './shell/bash';
import { getFishGlobals } from './shell/fish';
import { getPwshGlobals } from './shell/pwsh';
import { getZshGlobals } from './shell/zsh';
import { defaultShellTypeResetChars, getTokenType, shellTypeResetChars, TokenType } from './tokens';
import type { ICompletionResource } from './types';
import { TerminalShellType } from './constants';

const isWindows = osIsWindows();
type ShellGlobalsCacheEntry = {
	commands: ICompletionResource[] | undefined;
	existingCommands?: string[];
};

type ShellGlobalsCacheEntryWithMeta = ShellGlobalsCacheEntry & { timestamp: number };
const cachedGlobals: Map<string, ShellGlobalsCacheEntryWithMeta> = new Map();
const inflightRequests: Map<string, Promise<ICompletionResource[] | undefined>> = new Map();
let pathExecutableCache: PathExecutableCache;
const CACHE_KEY = 'terminalSuggestGlobalsCacheV2';
let globalStorageUri: vscode.Uri;
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function getCacheKey(machineId: string, remoteAuthority: string | undefined, shellType: TerminalShellType): string {
	return `${machineId}:${remoteAuthority ?? 'local'}:${shellType}`;
}

export const availableSpecs: Fig.Spec[] = [
	azdSpec,
	cdSpec,
	codeInsidersCompletionSpec,
	codeCompletionSpec,
	codeTunnelCompletionSpec,
	codeTunnelInsidersCompletionSpec,
	gitCompletionSpec,
	ghCompletionSpec,
	npmCompletionSpec,
	npxCompletionSpec,
	pnpmCompletionSpec,
	setLocationSpec,
	yarnCompletionSpec,
	...Object.values(upstreamSpecs)
];

const getShellSpecificGlobals: Map<TerminalShellType, (options: ExecOptionsWithStringEncoding, existingCommands?: Set<string>) => Promise<(string | ICompletionResource)[]>> = new Map([
	[TerminalShellType.Bash, getBashGlobals],
	[TerminalShellType.Zsh, getZshGlobals],
	[TerminalShellType.GitBash, getBashGlobals],
	[TerminalShellType.Fish, getFishGlobals],
	[TerminalShellType.PowerShell, getPwshGlobals],
	[TerminalShellType.WindowsPowerShell, getPwshGlobals],
]);

async function getShellGlobals(
	shellType: TerminalShellType,
	existingCommands?: Set<string>,
	machineId?: string,
	remoteAuthority?: string
): Promise<ICompletionResource[] | undefined> {
	if (!machineId) {
		return await fetchAndCacheShellGlobals(shellType, existingCommands, undefined, undefined);
	}
	const cacheKey = getCacheKey(machineId, remoteAuthority, shellType);
	const cached = cachedGlobals.get(cacheKey);
	const now = Date.now();
	const existingCommandsArr = existingCommands ? Array.from(existingCommands) : undefined;
	let shouldRefresh = false;
	if (cached) {
		if (now - cached.timestamp > CACHE_MAX_AGE_MS) {
			cachedGlobals.delete(cacheKey);
			await writeGlobalsCache();
		} else {
			if (existingCommandsArr && cached.existingCommands) {
				if (existingCommandsArr.length !== cached.existingCommands.length) {
					shouldRefresh = true;
				}
			} else if (existingCommandsArr || cached.existingCommands) {
				shouldRefresh = true;
			}
			if (!shouldRefresh && cached.commands) {
				return cached.commands;
			}
		}
	}
	return await fetchAndCacheShellGlobals(shellType, existingCommands, machineId, remoteAuthority);
}

async function fetchAndCacheShellGlobals(
	shellType: TerminalShellType,
	existingCommands?: Set<string>,
	machineId?: string,
	remoteAuthority?: string,
	background?: boolean
): Promise<ICompletionResource[] | undefined> {
	const cacheKey = getCacheKey(machineId ?? 'no-machine-id', remoteAuthority, shellType);

	const cached = cachedGlobals.get(cacheKey);
	if (cached) {
		return cached.commands;
	}

	const existingRequest = inflightRequests.get(cacheKey);
	if (existingRequest) {
		return existingRequest;
	}

	const requestPromise = (async () => {
		try {
			let execShellType = shellType;
			if (shellType === TerminalShellType.GitBash) {
				execShellType = TerminalShellType.Bash;
			}
			const options: ExecOptionsWithStringEncoding = { encoding: 'utf-8', shell: execShellType, windowsHide: true };
			const mixedCommands: (string | ICompletionResource)[] | undefined = await getShellSpecificGlobals.get(shellType)?.(options, existingCommands);
			const normalizedCommands = mixedCommands?.map(command => typeof command === 'string' ? ({ label: command }) : command);
			if (machineId) {
				const cacheKey = getCacheKey(machineId, remoteAuthority, shellType);
				cachedGlobals.set(cacheKey, {
					commands: normalizedCommands,
					existingCommands: existingCommands ? Array.from(existingCommands) : undefined,
					timestamp: Date.now()
				});
				await writeGlobalsCache();
			}
			return normalizedCommands;
		} catch (error) {
			if (!background) {
				console.error('Error fetching builtin commands:', error);
			}
			return;
		} finally {
			inflightRequests.delete(cacheKey);
		}
	})();

	inflightRequests.set(cacheKey, requestPromise);

	return requestPromise;
}


async function writeGlobalsCache(): Promise<void> {
	if (!globalStorageUri) {
		return;
	}
	const now = Date.now();
	for (const [key, value] of cachedGlobals.entries()) {
		if (now - value.timestamp > CACHE_MAX_AGE_MS) {
			cachedGlobals.delete(key);
		}
	}
	const obj: Record<string, ShellGlobalsCacheEntryWithMeta> = {};
	for (const [key, value] of cachedGlobals.entries()) {
		obj[key] = value;
	}
	try {
		const terminalSuggestDir = vscode.Uri.joinPath(globalStorageUri, 'terminal-suggest');
		await vscode.workspace.fs.createDirectory(terminalSuggestDir);
		const cacheFile = vscode.Uri.joinPath(terminalSuggestDir, `${CACHE_KEY}.json`);
		const data = Buffer.from(JSON.stringify(obj), 'utf8');
		await vscode.workspace.fs.writeFile(cacheFile, data);
	} catch (err) {
		console.error('Failed to write terminal suggest globals cache:', err);
	}
}


async function readGlobalsCache(): Promise<void> {
	if (!globalStorageUri) {
		return;
	}
	try {
		const terminalSuggestDir = vscode.Uri.joinPath(globalStorageUri, 'terminal-suggest');
		const cacheFile = vscode.Uri.joinPath(terminalSuggestDir, `${CACHE_KEY}.json`);
		const data = await vscode.workspace.fs.readFile(cacheFile);
		const obj = JSON.parse(data.toString()) as Record<string, ShellGlobalsCacheEntryWithMeta>;
		if (obj) {
			for (const key of Object.keys(obj)) {
				cachedGlobals.set(key, obj[key]);
			}
		}
	} catch (err) {
		if (err instanceof vscode.FileSystemError && err.code === 'FileNotFound') {
			return;
		}
		console.error('Failed to read terminal suggest globals cache:', err);
	}
}



export async function activate(context: vscode.ExtensionContext) {
	pathExecutableCache = new PathExecutableCache();
	context.subscriptions.push(pathExecutableCache);
	let currentTerminalEnv: ITerminalEnvironment = process.env;

	globalStorageUri = context.globalStorageUri;
	await readGlobalsCache();

	const machineId = await vscode.env.machineId;
	const remoteAuthority = vscode.env.remoteName;

	context.subscriptions.push(vscode.window.registerTerminalCompletionProvider({
		async provideTerminalCompletions(terminal: vscode.Terminal, terminalContext: vscode.TerminalCompletionContext, token: vscode.CancellationToken): Promise<vscode.TerminalCompletionItem[] | vscode.TerminalCompletionList | undefined> {
			currentTerminalEnv = terminal.shellIntegration?.env?.value ?? process.env;
			if (token.isCancellationRequested) {
				console.debug('#terminalCompletions token cancellation requested');
				return;
			}

			const shellType: string | undefined = Object.hasOwn(terminal.state, 'shell') ? terminal.state.shell as string : undefined;
			const terminalShellType = getTerminalShellType(shellType);
			if (!terminalShellType) {
				console.debug(`#terminalCompletions Shell type ${shellType} not supported`);
				return;
			}

			const commandsInPath = await pathExecutableCache.getExecutablesInPath(terminal.shellIntegration?.env?.value, terminalShellType);
			const shellGlobals = await getShellGlobals(terminalShellType, commandsInPath?.labels, machineId, remoteAuthority) ?? [];

			if (!commandsInPath?.completionResources) {
				console.debug('#terminalCompletions No commands found in path');
				return;
			}

			const commands = [...shellGlobals, ...commandsInPath.completionResources];
			const currentCommandString = getCurrentCommandAndArgs(terminalContext.commandLine, terminalContext.cursorIndex, terminalShellType);
			const pathSeparator = isWindows ? '\\' : '/';
			const tokenType = getTokenType(terminalContext, terminalShellType);
			const result = await Promise.race([
				getCompletionItemsFromSpecs(
					availableSpecs,
					terminalContext,
					commands,
					currentCommandString,
					tokenType,
					terminal.shellIntegration?.cwd,
					getEnvAsRecord(currentTerminalEnv),
					terminal.name,
					token
				),
				createTimeoutPromise(5000, undefined)
			]);
			if (!result) {
				console.debug('#terminalCompletions Timed out fetching completions from specs');
				return;
			}

			if (terminal.shellIntegration?.env) {
				const homeDirCompletion = result.items.find(i => i.label === '~');
				if (homeDirCompletion && terminal.shellIntegration.env?.value?.HOME) {
					homeDirCompletion.documentation = getFriendlyResourcePath(vscode.Uri.file(terminal.shellIntegration.env.value.HOME), pathSeparator, vscode.TerminalCompletionItemKind.Folder);
					homeDirCompletion.kind = vscode.TerminalCompletionItemKind.Folder;
				}
			}

			const cwd = result.cwd ?? terminal.shellIntegration?.cwd;
			if (cwd && (result.showFiles || result.showDirectories)) {
				const globPattern = createFileGlobPattern(result.fileExtensions);
				return new vscode.TerminalCompletionList(result.items, {
					showFiles: result.showFiles,
					showDirectories: result.showDirectories,
					globPattern,
					cwd,
				});
			}
			return result.items;
		}
	}, '/', '\\'));
	watchPathDirectories(context, currentTerminalEnv, pathExecutableCache);

	context.subscriptions.push(vscode.commands.registerCommand('terminal.integrated.suggest.clearCachedGlobals', () => {
		cachedGlobals.clear();
	}));
}

async function watchPathDirectories(context: vscode.ExtensionContext, env: ITerminalEnvironment, pathExecutableCache: PathExecutableCache | undefined): Promise<void> {
	const pathDirectories = new Set<string>();

	const envPath = env.PATH;
	if (envPath) {
		envPath.split(delimiter).forEach(p => pathDirectories.add(p));
	}

	const activeWatchers = new Set<string>();

	let debounceTimer: NodeJS.Timeout | undefined;
	function handleChange() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(() => {
			pathExecutableCache?.refresh();
			debounceTimer = undefined;
		}, 300);
	}

	for (const dir of pathDirectories) {
		if (activeWatchers.has(dir)) {
			continue;
		}

		try {
			const stat = await fs.promises.stat(dir);
			if (!stat.isDirectory()) {
				continue;
			}
		} catch {
			continue;
		}

		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '*'));
		context.subscriptions.push(
			watcher,
			watcher.onDidCreate(() => handleChange()),
			watcher.onDidChange(() => handleChange()),
			watcher.onDidDelete(() => handleChange())
		);

		activeWatchers.add(dir);
	}
}

export async function resolveCwdFromCurrentCommandString(currentCommandString: string, currentCwd?: vscode.Uri): Promise<vscode.Uri | undefined> {
	const prefix = currentCommandString.split(/\s+/).pop()?.trim() ?? '';

	if (!currentCwd) {
		return;
	}
	try {
		let lastSlashIndex: number;
		if (isWindows) {
			lastSlashIndex = prefix.lastIndexOf('\\');
			if (lastSlashIndex === -1) {
				lastSlashIndex = prefix.lastIndexOf('/');
			}
		} else {
			lastSlashIndex = prefix.lastIndexOf('/');
		}
		const relativeFolder = lastSlashIndex === -1 ? '' : prefix.slice(0, lastSlashIndex);

		if (relativeFolder.includes('..')) {
			return undefined;
		}

		const resolvedUri = vscode.Uri.joinPath(currentCwd, relativeFolder);

		const stat = await vscode.workspace.fs.stat(resolvedUri);
		if (stat.type & vscode.FileType.Directory) {
			return resolvedUri;
		}
	} catch {
	}

	return undefined;
}

export function getCurrentCommandAndArgs(commandLine: string, cursorIndex: number, shellType: TerminalShellType | undefined): string {

	if (commandLine.trim() === '') {
		return '';
	}

	if (cursorIndex < commandLine.length && /\S/.test(commandLine[cursorIndex])) {
		return '';
	}

	const beforeCursor = commandLine.slice(0, cursorIndex);

	const resetChars = shellType ? shellTypeResetChars.get(shellType) ?? defaultShellTypeResetChars : defaultShellTypeResetChars;
	let lastResetIndex = -1;
	for (const char of resetChars) {
		const idx = beforeCursor.lastIndexOf(char);
		if (idx > lastResetIndex) {
			lastResetIndex = idx;
		}
	}

	const currentCommandStart = lastResetIndex + 1;
	const currentCommandString = beforeCursor.slice(currentCommandStart).replace(/^\s+/, '');

	return currentCommandString;
}

export function asArray<T>(x: T | T[]): T[];
export function asArray<T>(x: T | readonly T[]): readonly T[];
export function asArray<T>(x: T | T[]): T[] {
	return Array.isArray(x) ? x : [x];
}

export async function getCompletionItemsFromSpecs(
	specs: Fig.Spec[],
	terminalContext: vscode.TerminalCompletionContext,
	availableCommands: ICompletionResource[],
	currentCommandString: string,
	tokenType: TokenType,
	shellIntegrationCwd: vscode.Uri | undefined,
	env: Record<string, string>,
	name: string,
	token?: vscode.CancellationToken,
	executeExternals?: IFigExecuteExternals,
): Promise<{ items: vscode.TerminalCompletionItem[]; showFiles: boolean; showDirectories: boolean; fileExtensions?: string[]; cwd?: vscode.Uri }> {
	let items: vscode.TerminalCompletionItem[] = [];
	let showFiles = false;
	let showDirectories = false;
	let hasCurrentArg = false;
	let fileExtensions: string[] | undefined;

	if (isWindows) {
		const spaceIndex = currentCommandString.indexOf(' ');
		const commandEndIndex = spaceIndex === -1 ? currentCommandString.length : spaceIndex;
		const lastDotIndex = currentCommandString.lastIndexOf('.', commandEndIndex);
		if (lastDotIndex > 0) {
			currentCommandString = currentCommandString.substring(0, lastDotIndex) + currentCommandString.substring(spaceIndex);
		}
	}

	let executeExternalsFallbackCwd = shellIntegrationCwd?.fsPath;
	if (!executeExternalsFallbackCwd) {
		console.error('No shellIntegrationCwd set, falling back to process.cwd()');
		executeExternalsFallbackCwd = process.cwd();
	}
	const executeExternalsFallbacks: {
		cwd: string;
		env: Record<string, string | undefined>;
	} = {
		cwd: executeExternalsFallbackCwd,
		env,
	};
	const executeExternalsWithFallback = executeExternals ?? {
		executeCommand: executeCommand.bind(executeCommand, executeExternalsFallbacks),
		executeCommandTimeout: executeCommandTimeout.bind(executeCommandTimeout, executeExternalsFallbacks),
	};

	const result = await getFigSuggestions(specs, terminalContext, availableCommands, currentCommandString, tokenType, shellIntegrationCwd, env, name, executeExternalsWithFallback, token);
	if (result) {
		hasCurrentArg ||= result.hasCurrentArg;
		showFiles ||= result.showFiles;
		showDirectories ||= result.showDirectories;
		fileExtensions = result.fileExtensions;
		if (result.items) {
			items = items.concat(result.items);
		}
	}

	if (tokenType === TokenType.Command) {
		const labels = new Set(items.map((i) => typeof i.label === 'string' ? i.label : i.label.label));
		for (const command of availableCommands) {
			const commandTextLabel = typeof command.label === 'string' ? command.label : command.label.label;
			const labelWithoutExtension = isWindows ? commandTextLabel.replace(/\.[^ ]+$/, '') : commandTextLabel;
			if (!labels.has(labelWithoutExtension)) {
				items.push(createCompletionItem(
					terminalContext.cursorIndex,
					currentCommandString,
					command,
					command.detail,
					command.documentation,
					vscode.TerminalCompletionItemKind.Method
				));
				labels.add(commandTextLabel);
			}
			else {
				const existingItem = items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === commandTextLabel);
				if (!existingItem) {
					continue;
				}

				existingItem.documentation ??= command.documentation;
				existingItem.detail ??= command.detail;
			}
		}
		showFiles = true;
		showDirectories = true;
	} else if (!items.length && !showFiles && !showDirectories && !hasCurrentArg) {
		showFiles = true;
		showDirectories = true;
	}

	let cwd: vscode.Uri | undefined;
	if (shellIntegrationCwd && (showFiles || showDirectories)) {
		cwd = await resolveCwdFromCurrentCommandString(currentCommandString, shellIntegrationCwd);
	}

	return { items, showFiles, showDirectories, fileExtensions, cwd };
}

function getEnvAsRecord(shellIntegrationEnv: ITerminalEnvironment): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(shellIntegrationEnv ?? process.env)) {
		if (typeof value === 'string') {
			env[key] = value;
		}
	}
	if (!shellIntegrationEnv) {
		sanitizeProcessEnvironment(env);
	}
	return env;
}

function getTerminalShellType(shellType: string | undefined): TerminalShellType | undefined {
	switch (shellType) {
		case 'bash':
			return TerminalShellType.Bash;
		case 'gitbash':
			return TerminalShellType.GitBash;
		case 'zsh':
			return TerminalShellType.Zsh;
		case 'pwsh':
			return basename(vscode.env.shell, '.exe') === 'powershell' ? TerminalShellType.WindowsPowerShell : TerminalShellType.PowerShell;
		case 'fish':
			return TerminalShellType.Fish;
		default:
			return undefined;
	}
}

export function sanitizeProcessEnvironment(env: Record<string, string>, ...preserve: string[]): void {
	const set = preserve.reduce<Record<string, boolean>>((set, key) => {
		set[key] = true;
		return set;
	}, {});
	const keysToRemove = [
		/^ELECTRON_.$/,
		/^VSCODE_(?!(PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)).+$/,
		/^SNAP(|_.*)$/,
		/^GDK_PIXBUF_.$/,
	];
	const envKeys = Object.keys(env);
	envKeys
		.filter(key => !set[key])
		.forEach(envKey => {
			for (let i = 0; i < keysToRemove.length; i++) {
				if (envKey.search(keysToRemove[i]) !== -1) {
					delete env[envKey];
					break;
				}
			}
		});
}

function createFileGlobPattern(fileExtensions?: string[]): string | undefined {
	if (!fileExtensions || fileExtensions.length === 0) {
		return undefined;
	}
	const exts = fileExtensions.map(ext => ext.startsWith('.') ? ext.slice(1) : ext);
	if (exts.length === 1) {
		return `**/*.${exts[0]}`;
	}
	return `**/*.{${exts.join(',')}}`;
}
